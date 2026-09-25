/* Halcyon Compute — static content: catalog, chapter list, markets, text pools.
 * No rules here (those live in js/sim.js). Classic script (window.SimContent) + CommonJS.
 * Money in $k, time in days.
 */
(function (root, factory) {
  const C = factory();
  if (typeof module === "object" && module.exports) module.exports = C;
  else { root.SimContent = C; (root.__factories = root.__factories || {}).content = factory; }   // factory: js/pace.js builds its worker from it
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const WORKLOADS = ["train", "infer"];
  const INTENSITY = { train: 2.0, infer: 0.5 };        // FLOP per byte: roofline x-axis
  const NET_NEED = { train: 4, infer: 2, cpu: 0.5, exotic: 1 };
  const MODES = {
    eco:   { kw: 0.65, out: 0.8,  label: "Eco" },
    std:   { kw: 1,    out: 1,    label: "Standard" },
    boost: { kw: 1.35, out: 1.12, label: "Boost" },
    off:   { kw: 0,    out: 0,    label: "Off" },      // v4: park hardware with no contract (0 power, 0 output, no failures)
  };
  const MARKET = {
    web:   { base: 0.18, demand: 30, growth: 1.0,  drift: 1.0 },   // demand = the ablation buyer's volume + bot pipeline; v4 web offers are price-elastic (sim K.WEB_*)
    train: { base: 0.25, demand: 60, growth: 1.25, drift: 0.985 },
    infer: { base: 0.55, demand: 25, growth: 2.2,  drift: 0.985 },
  };
  const GEN_LAUNCH = [390, 780, 1170, 1560];
  const GEN_DROP = { train: 0.72, infer: 0.75 };

  /* catalog. F = compute, B = memory bandwidth (roofline). avail = first day on sale.
     Per generation: ~1.55x F and B, ~+8 % kW, ~+20 % price.
     v3 balance: GPU list prices x1.6 (mid-game paybacks ~200-300 days, so reinvestment absorbs profit; DECISIONS D35). */
  const BASE_ITEMS = {
    sw:  { name: "Ferro 48P switch", role: "net",  u: 1, kw: 0.4, price: 25, net: 16, avail: 0, vendor: "ferro", icon: "switch" },
    cpu: { name: "Tern web server",  role: "cpu",  u: 1, kw: 0.8, price: 12, avail: 0, vendor: "tern", icon: "cpu" },
    cru: { name: "Brisa CRU cooler", role: "cool", u: 2, kw: 0.6, price: 45, cool: 12, avail: 0, ch: "heat", vendor: "brisa", icon: "snow" },
    c1:  { name: "Kestrel C1", role: "gpu", fam: "C", gen: 1, u: 4, kw: 6.0, price: 288, F: 10, B: 4,  avail: 0, ch: "gpu", vendor: "kestrel", icon: "chip" },
    m1:  { name: "Heron M1",   role: "gpu", fam: "M", gen: 1, u: 4, kw: 5.0, price: 320, F: 6,  B: 8,  avail: 0, ch: "gpu", vendor: "heron", icon: "chip" },
    c2:  { name: "Kestrel C2", role: "gpu", fam: "C", gen: 2, u: 4, kw: 6.5, price: 368, F: 16, B: 6,  avail: 390,  vendor: "kestrel", icon: "chip" },
    m2:  { name: "Heron M2",   role: "gpu", fam: "M", gen: 2, u: 4, kw: 5.5, price: 400, F: 9,  B: 13, avail: 390,  vendor: "heron", icon: "chip" },
    c3:  { name: "Kestrel C3", role: "gpu", fam: "C", gen: 3, u: 4, kw: 7.0, price: 448, F: 25, B: 9,  avail: 780,  vendor: "kestrel", icon: "chip" },
    m3:  { name: "Heron M3",   role: "gpu", fam: "M", gen: 3, u: 4, kw: 6.0, price: 480, F: 14, B: 21, avail: 780,  vendor: "heron", icon: "chip" },
    c4:  { name: "Kestrel C4", role: "gpu", fam: "C", gen: 4, u: 4, kw: 7.5, price: 536, F: 39, B: 14, avail: 1170, vendor: "kestrel", icon: "chip" },
    m4:  { name: "Heron M4",   role: "gpu", fam: "M", gen: 4, u: 4, kw: 6.5, price: 576, F: 22, B: 33, avail: 1170, vendor: "heron", icon: "chip" },
    c5:  { name: "Kestrel C5", role: "gpu", fam: "C", gen: 5, u: 4, kw: 8.1, price: 640, F: 60, B: 22, avail: 1560, vendor: "kestrel", icon: "chip" },
    m5:  { name: "Heron M5",   role: "gpu", fam: "M", gen: 5, u: 4, kw: 7.0, price: 688, F: 34, B: 51, avail: 1560, vendor: "heron", icon: "chip" },
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

  /* chapters. mech = ablation flag that disables the chapter (null = always on).
     v4 (DECISIONS D49): chapters unlock in order on player MILESTONES (js/sim.js `milestone`), not on calendar days.
     `day` = the earliest day the chapter may unlock; `hint` = the trigger in plain words (for the UI's "next chapter" tip).
     At most one chapter per K.CH_GAP days. Sandbox still unlocks everything on day 0.
     v4 core loop (docs/CONTRACTS_CORE.md): all money comes from contracts; ch8 now teaches long-term deals. */
  const CHAPTERS = [
    { day: 0,    key: "racks",       mech: null,          title: "Racks and contracts",
      hint: "",
      bullets: ["All money comes from contracts: sign offers on the order board, then deliver", "Build the capacity before a contract starts: orders ship in 6 days, a technician installs them in 2", "Every rack needs a switch, or it delivers nothing", "Hardware with no contract earns nothing: switch it Off"] },
    { day: 20,   key: "power",       mech: null,          title: "Power",
      hint: "Sign 2 offers, run 4 racks, or draw more than a third of your grid",
      bullets: ["Your grid feed is 250 kW; you can upgrade it to 400 kW", "Power costs more in summer", "Each rack runs Eco, Standard or Boost: less or more output for less or more power"] },
    { day: 60,   key: "gpu",         mech: null,          title: "GPUs: match the card to the job",
      hint: "Afford a GPU and a switch, or complete 2 contracts",
      bullets: ["Kestrel C cards are fast at math; Heron M cards are fast at moving data (memory bandwidth)", "Training does a lot of math per byte; inference moves a lot of data for little math", "Inference contracts pay per unit served; training jobs pay once the work is done, by a deadline", "A card delivers by its weaker side on the job: C cards on training, M cards on inference"] },
    { day: 100,  key: "heat",        mech: "heat",        title: "Summer is coming",
      hint: "Own 2 GPUs and head into a summer that would run your hall hot",
      bullets: ["Your cooling handles less heat in summer", "Rooms warm up slowly, over days", "Hot racks warm their neighbours; above 32 °C they slow down and miss deliveries", "CRU coolers add cooling inside a rack"] },
    { day: 150,  key: "gens",        mech: "gens",        title: "Hardware generations",
      hint: "Own 4 GPUs when a new generation is rumoured",
      bullets: ["New GPU generations arrive on days 390, 780, 1170 and 1560", "Rumours arrive about 60 days early", "Each launch cuts the price of new offers and what older cards resell for", "Signed contracts keep their price: lock long deals before a launch"] },
    { day: 200,  key: "ops",         mech: "ops",         title: "Operations",
      hint: "Run 30 devices or 8 GPUs",
      bullets: ["Hardware breaks: brand-new, old and hot parts break most", "A repair needs parts and a technician", "Hire or fire technicians", "Spare parts on the shelf swap in within a day: keep a buffer"] },
    { day: 250,  key: "fabric",      mech: "fabric",      title: "Network fabric",
      hint: "Run 8 training GPUs (or 14 GPUs)",
      bullets: ["A row spine joins the racks of one row into one cluster", "Frontier training jobs pay 1.6x, but only 12+ training GPUs on one spined row count", "Web and inference traffic needs internet transit"] },
    { day: 300,  key: "contracts",   mech: "contracts",   title: "Long-term deals",
      hint: "Complete 5 contracts",
      bullets: ["Build-to-suit: a big customer pays for dedicated capacity for a year or more", "You pay the fit-out up front; delivery starts 45 days after signing", "Missed units cost 3x the price: keep a buffer", "A long deal fixes today's price: sign before a known launch, not after"] },
    { day: 350,  key: "memory",      mech: "memory",      title: "Memory market",
      hint: "Order 10 GPUs",
      bullets: ["GPU prices follow the memory-chip (HBM) price index", "Shortages triple GPU shipping time", "Scare stories: about 1 in 3 is false", "Forward orders lock today's price"] },
    { day: 400,  key: "finance",     mech: "finance",     title: "Finance",
      hint: "Owe more capacity than you can pay for, or earn $500k in a quarter",
      bullets: ["Borrow up to 40 % of your net worth at 9 % a year", "Lease GPUs: nothing up front, pay per day", "21 % tax on each quarter's profit"] },
    { day: 450,  key: "facilities",  mech: "facilities",  title: "Facilities and resilience",
      hint: "Fill 80 % of Hall 1, or use 85 % of your grid",
      bullets: ["Build Hall 2, then Hall 3 (18 racks each)", "Grid outages stop everything, and every contract misses", "Backup power (UPS + generator) rides through outages", "Room-cooling upgrade (CRAC): +45 kW per hall"] },
    { day: 500,  key: "energy",      mech: "energy",      title: "Energy sourcing",
      hint: "Let power reach a third of your costs",
      bullets: ["Market (spot) power prices swing; heat waves spike them", "A power purchase agreement (PPA) fixes the price of green power for 540 days", "Solar + battery shaves the spikes"] },
    { day: 550,  key: "environment", mech: "environment", title: "Environment",
      hint: "Live through a heat wave",
      bullets: ["Evaporative cooling: 15 % power overhead, but uses water", "Chillers: no water, but 45 % power overhead", "Droughts cut evaporative cooling by 40 %", "Your carbon is tracked"] },
    { day: 600,  key: "investors",   mech: "investors",   title: "Investors",
      hint: "Earn $2M over half a year",
      bullets: ["Venture capital (VC) firms offer cash for a share of your company", "The board then sets revenue targets", "Miss two in a row and you are fired", "Your score = your share of the company's value"] },
    { day: 650,  key: "reputation",  mech: "reputation",  title: "Reputation and PR",
      hint: "Miss a delivery, or suffer an outage",
      bullets: ["Reputation moves how often offers come and what they pay, and your valuation", "Missed deliveries, outages and water use in droughts hurt it", "PR campaigns help, unless a scandal is live"] },
    { day: 700,  key: "policy",      mech: "policy",      title: "Policy",
      hint: "Emit 2 tonnes of carbon a day",
      bullets: ["Proposed laws come with a vote date", "Read the news signals: will it pass?", "Carbon tax, efficiency mandate, chip export controls", "Lobbying shifts the odds, if the press doesn't find out"] },
    { day: 1200, key: "disrupt",     mech: "disrupt",     title: "Something new",
      hint: "Know the generations chapter when startups start demoing (from day 1200)",
      bullets: ["Two startups, one is real", "A pilot card shows real field performance", "Vendor pitches are biased", "Demand itself may shift"] },
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
  const ANCHOR = { name: "Wren Hosting", icon: "cart" };     // v4: the customer you start with (signed for the whole game)
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
    CHAPTERS, CUSTOMERS, ANCHOR, VCS, SCARES, SCARE_FOLLOW, POLICIES, POLICY_SIGNALS, PRESS,
  };
});
