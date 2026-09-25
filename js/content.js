/* Halcyon Compute — static content: catalog, chapter list, markets, text pools.
 * No rules here (those live in js/sim.js). Classic script (window.SimContent) + CommonJS.
 * Money in $k, time in days.
 */
(function (root, factory) {
  const C = factory();
  if (typeof module === "object" && module.exports) module.exports = C;
  else root.SimContent = C;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WORKLOADS = ["train", "infer"];
  const INTENSITY = { train: 2.0, infer: 0.5 };        // FLOP per byte: roofline x-axis
  const NET_NEED = { train: 4, infer: 2, cpu: 0.5, exotic: 1 };
  const MODES = {
    eco:   { kw: 0.65, out: 0.8,  label: "Eco" },
    std:   { kw: 1,    out: 1,    label: "Standard" },
    boost: { kw: 1.35, out: 1.12, label: "Boost" },
  };
  const MARKET = {
    web:   { base: 0.18, demand: 30, growth: 1.0,  drift: 1.0 },
    train: { base: 0.25, demand: 60, growth: 1.25, drift: 0.985 },
    infer: { base: 0.55, demand: 25, growth: 2.2,  drift: 0.985 },
  };
  const GEN_LAUNCH = [390, 780, 1170, 1560];
  const GEN_DROP = { train: 0.72, infer: 0.75 };

  /* catalog. F = compute, B = memory bandwidth (roofline). avail = first day on sale.
     Per generation: ~1.55x F and B, ~+8 % kW, ~+20 % price. */
  const BASE_ITEMS = {
    sw:  { name: "Ferro 48P switch", role: "net",  u: 1, kw: 0.4, price: 25, net: 16, avail: 0, vendor: "ferro", icon: "switch" },
    cpu: { name: "Tern web server",  role: "cpu",  u: 1, kw: 0.8, price: 12, avail: 0, vendor: "tern", icon: "cpu" },
    cru: { name: "Brisa CRU cooler", role: "cool", u: 2, kw: 0.6, price: 45, cool: 12, avail: 120, vendor: "brisa", icon: "snow" },
    c1:  { name: "Kestrel C1", role: "gpu", fam: "C", gen: 1, u: 4, kw: 6.0, price: 180, F: 10, B: 4,  avail: 60,   vendor: "kestrel", icon: "chip" },
    m1:  { name: "Heron M1",   role: "gpu", fam: "M", gen: 1, u: 4, kw: 5.0, price: 200, F: 6,  B: 8,  avail: 60,   vendor: "heron", icon: "chip" },
    c2:  { name: "Kestrel C2", role: "gpu", fam: "C", gen: 2, u: 4, kw: 6.5, price: 230, F: 16, B: 6,  avail: 390,  vendor: "kestrel", icon: "chip" },
    m2:  { name: "Heron M2",   role: "gpu", fam: "M", gen: 2, u: 4, kw: 5.5, price: 250, F: 9,  B: 13, avail: 390,  vendor: "heron", icon: "chip" },
    c3:  { name: "Kestrel C3", role: "gpu", fam: "C", gen: 3, u: 4, kw: 7.0, price: 280, F: 25, B: 9,  avail: 780,  vendor: "kestrel", icon: "chip" },
    m3:  { name: "Heron M3",   role: "gpu", fam: "M", gen: 3, u: 4, kw: 6.0, price: 300, F: 14, B: 21, avail: 780,  vendor: "heron", icon: "chip" },
    c4:  { name: "Kestrel C4", role: "gpu", fam: "C", gen: 4, u: 4, kw: 7.5, price: 335, F: 39, B: 14, avail: 1170, vendor: "kestrel", icon: "chip" },
    m4:  { name: "Heron M4",   role: "gpu", fam: "M", gen: 4, u: 4, kw: 6.5, price: 360, F: 22, B: 33, avail: 1170, vendor: "heron", icon: "chip" },
    c5:  { name: "Kestrel C5", role: "gpu", fam: "C", gen: 5, u: 4, kw: 8.1, price: 400, F: 60, B: 22, avail: 1560, vendor: "kestrel", icon: "chip" },
    m5:  { name: "Heron M5",   role: "gpu", fam: "M", gen: 5, u: 4, kw: 7.0, price: 430, F: 34, B: 51, avail: 1560, vendor: "heron", icon: "chip" },
    pm9: { name: "Nanofab PM-900", role: "mem", u: 2, kw: 0.8, price: 150, boost: 1.25, avail: 1330, vendor: "nanofab", icon: "layers" },
    // exotic accelerators: fixed workload, need an immersion tank rack. Which vendor is real is seeded.
    lat1: { name: "Lattice L1", role: "exotic", only: "infer", u: 2, kw: 1.2, price: 55, F: 2, B: 3,  avail: 1290, vendor: "lattice", icon: "drop", tank: true, model: 0 },
    lat2: { name: "Lattice L2", role: "exotic", only: "infer", u: 2, kw: 1.4, price: 65, F: 5, B: 8,  avail: 1440, vendor: "lattice", icon: "drop", tank: true, model: 1 },
    lat3: { name: "Lattice L3", role: "exotic", only: "infer", u: 2, kw: 1.5, price: 75, F: 9, B: 15, avail: 1590, vendor: "lattice", icon: "drop", tank: true, model: 2 },
    pho1: { name: "Photon P1",  role: "exotic", only: "train", u: 2, kw: 1.2, price: 55, F: 1.5, B: 1,   avail: 1290, vendor: "photon", icon: "rocket", tank: true, model: 0 },
    pho2: { name: "Photon P2",  role: "exotic", only: "train", u: 2, kw: 1.4, price: 65, F: 4,   B: 2.5, avail: 1440, vendor: "photon", icon: "rocket", tank: true, model: 1 },
    pho3: { name: "Photon P3",  role: "exotic", only: "train", u: 2, kw: 1.5, price: 75, F: 7.5, B: 4,   avail: 1590, vendor: "photon", icon: "rocket", tank: true, model: 2 },
  };
  const SHOP_ORDER = ["sw", "cpu", "cru", "c1", "m1", "c2", "m2", "c3", "m3", "c4", "m4", "c5", "m5", "pm9",
    "lat1", "lat2", "lat3", "pho1", "pho2", "pho3"];
  const VENDORS = ["ferro", "tern", "brisa", "kestrel", "heron", "nanofab", "lattice", "photon"];
  /* roofline ablation: both families identical per generation */
  const FLAT_F = [0, 8, 12.5, 19.5, 30, 47], FLAT_B = [0, 6, 9.5, 15, 23, 36];

  /* chapters. mech = ablation flag that disables the chapter (null = always on). */
  const CHAPTERS = [
    { day: 0,    key: "racks",       mech: null,          title: "Racks and cash",
      bullets: ["18 racks, 20U and 30 kW each", "Every rack needs a switch", "Web servers sell to a flat market", "Technicians install: 6 days shipping + 2 days"] },
    { day: 30,   key: "power",       mech: null,          title: "Power",
      bullets: ["Grid cap 250 kW, upgrade to 400 kW", "Power price follows the seasons", "Eco / Standard / Boost per rack"] },
    { day: 60,   key: "gpu",         mech: null,          title: "GPUs and the roofline",
      bullets: ["Kestrel C = compute, Heron M = bandwidth", "Training and inference are separate markets", "Throughput = min(compute, bandwidth x intensity)"] },
    { day: 120,  key: "heat",        mech: "heat",        title: "Summer is coming",
      bullets: ["Cooling capacity drops in summer", "Rooms heat up slowly", "Hot neighbours throttle each other", "CRU coolers buy headroom"] },
    { day: 240,  key: "gens",        mech: "gens",        title: "Hardware generations",
      bullets: ["New generations land at d390, 780, 1170, 1560", "Rumours arrive ~60 days early", "Launches cut market prices and resale", "Old gen goes on sale"] },
    { day: 300,  key: "ops",         mech: "ops",         title: "Operations",
      bullets: ["Hardware fails: new, old and hot parts fail most", "Repairs need parts and a technician", "Hire or fire technicians", "Keep spares on the shelf"] },
    { day: 420,  key: "fabric",      mech: "fabric",      title: "Network fabric",
      bullets: ["Row spines pool training racks into clusters", "Frontier training pays 1.6x for 12+ GPU clusters", "Web and inference need internet transit"] },
    { day: 480,  key: "contracts",   mech: "contracts",   title: "Customers and contracts",
      bullets: ["Offers arrive as cards: sign or decline", "Contracts are served first at a fixed price", "Miss the SLA and pay the penalty", "Quotes track today's spot price"] },
    { day: 570,  key: "memory",      mech: "memory",      title: "Memory market",
      bullets: ["GPU prices follow the HBM index", "Shortages triple GPU shipping time", "Scare stories: about 1 in 3 is false", "Forward orders lock today's price"] },
    { day: 660,  key: "finance",     mech: "finance",     title: "Finance",
      bullets: ["Borrow up to 40 % of net worth at 9 %", "Lease cards: no upfront, pay per day", "21 % tax on quarterly profit"] },
    { day: 750,  key: "facilities",  mech: "facilities",  title: "Facilities and resilience",
      bullets: ["Build Hall 2 (18 more racks)", "Grid outages stop everything", "UPS + generator covers outages", "CRAC upgrade: +45 kW cooling"] },
    { day: 840,  key: "energy",      mech: "energy",      title: "Energy sourcing",
      bullets: ["Spot power is volatile; heat waves spike it", "PPA: fixed green power for 540 days", "Solar + battery shaves spikes"] },
    { day: 930,  key: "environment", mech: "environment", title: "Environment",
      bullets: ["Evaporative (PUE 1.15, water) or chiller (PUE 1.45)", "Droughts cut evaporative cooling by 40 %", "Carbon is tracked"] },
    { day: 1020, key: "investors",   mech: "investors",   title: "Investors",
      bullets: ["VCs offer cash for equity", "The board sets revenue targets", "Miss two in a row and you are fired", "Score = your equity value"] },
    { day: 1110, key: "reputation",  mech: "reputation",  title: "Reputation and PR",
      bullets: ["Reputation moves contracts, demand and valuation", "SLA misses, outages and drought water hurt", "PR campaigns help, unless a scandal is live"] },
    { day: 1200, key: "policy",      mech: "policy",      title: "Policy",
      bullets: ["Proposals come with a vote date", "Read the signals: will it pass?", "Carbon tax, efficiency mandate, export controls", "Lobbying shifts the odds, if it stays quiet"] },
    { day: 1290, key: "disrupt",     mech: "disrupt",     title: "Something new",
      bullets: ["Two startups, one is real", "Pilots reveal field performance", "Vendor pitches are biased", "Demand itself may shift"] },
  ];

  const CUSTOMERS = [
    { name: "Northwind Labs", icon: "flask", foreign: false },
    { name: "Bluefin Retail", icon: "cart", foreign: false },
    { name: "Orca Health", icon: "heart", foreign: false },
    { name: "Juniper Media", icon: "play", foreign: false },
    { name: "Sable Robotics", icon: "robot", foreign: false },
    { name: "Kanto AI", icon: "globe", foreign: true },
    { name: "Mistral Bay Bank", icon: "bank", foreign: false },
    { name: "Tianhe Cloud", icon: "globe", foreign: true },
    { name: "Aurora Games", icon: "game", foreign: false },
    { name: "Volga Data", icon: "globe", foreign: true },
  ];
  const VCS = ["Sequoia-ish Partners", "Andromeda Ventures", "Lightbeam Capital", "Greylock-ish Growth", "Index Point"];

  const SCARES = [
    { title: "Fire at a major HBM fab", body: "Supplier says damage is \"limited\"." },
    { title: "Hyperscaler places HBM mega-order", body: "Analysts fear allocation for smaller buyers." },
    { title: "Earthquake near memory fab cluster", body: "Inspections under way." },
    { title: "HBM packaging line halted", body: "Contamination reported at an assembly partner." },
    { title: "Memory makers cut capex", body: "Leaked memo points to tighter supply next quarter." },
  ];
  const SCARE_FOLLOW = {
    real: { title: "Distributors start rationing HBM", body: "Allocation letters reach mid-size buyers." },
    fake: { title: "Memory supplier: output unaffected", body: "Shipments on schedule, spokesperson says." },
  };

  const POLICIES = [
    { kind: "carbonTax", title: "Carbon Pricing Act", body: "A per-tonne tax on emissions, ramping every quarter." },
    { kind: "mandate", title: "Datacenter Efficiency Mandate", body: "Halls must reach PUE 1.3 or better within 120 days of passage, or pay daily fines." },
    { kind: "export", title: "Advanced Chip Export Controls", body: "Newest-generation GPUs quota-limited; some foreign customers barred." },
  ];
  const POLICY_SIGNALS = {
    up: ["Bipartisan cosponsors join", "Committee advances the bill unanimously", "Industry group quietly drops opposition"],
    down: ["Committee adds amendments", "Key senator voices doubts", "Floor vote delayed"],
  };

  const PRESS = {
    drought: { title: "Datacenter drinks while town rations water", body: "Local paper names Halcyon's evaporative cooling." },
    outage: { title: "Outage takes Halcyon customers offline", body: "No backup power, reporters note." },
    sla: { title: "Customer complains about missed deliveries", body: "\"We were promised capacity.\"" },
    lobby: { title: "Halcyon lobbying revealed", body: "Leaked invoices show payments to a lobbying firm." },
  };

  return {
    WORKLOADS, INTENSITY, NET_NEED, MODES, MARKET, GEN_LAUNCH, GEN_DROP, BASE_ITEMS, SHOP_ORDER, VENDORS, FLAT_F, FLAT_B,
    CHAPTERS, CUSTOMERS, VCS, SCARES, SCARE_FOLLOW, POLICIES, POLICY_SIGNALS, PRESS,
  };
});
