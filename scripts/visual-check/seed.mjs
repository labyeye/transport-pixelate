const B = "http://localhost:5100/api/v1";
let tok = "";
const call = async (method, path, body) => {
  const r = await fetch(B + path, { method, headers: { "Content-Type": "application/json", ...(tok && { Authorization: `Bearer ${tok}` }) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const reg = await call("POST", "/auth/register", { organizationName: "Greenfield Public School", category: "school", name: "Asha Verma", email: "asha@greenfield.test", password: "password123" });
tok = reg.data.accessToken;
await call("PUT", "/settings/organization", { modules: { billing: true } });
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

const vehicles = [];
for (const [reg_, make, cap, odo] of [["MH12AB1234", "Tata Starbus", 40, 48210], ["MH12CD5678", "Ashok Leyland", 52, 90311], ["MH14EF9012", "Force Traveller", 18, 21500]]) {
  vehicles.push((await call("POST", "/vehicles", { registrationNumber: reg_, make, model: "Bus", capacity: cap, odometer: odo, fuelType: "diesel", documents: { insurance: { expiryDate: day(vehicles.length === 1 ? -5 : 200) }, fitness: { expiryDate: day(vehicles.length === 2 ? 12 : 300) } } })).data);
}
const drivers = [];
for (const [name, lic] of [["Ramesh Patil", "MH1220180001234"], ["Suresh Jadhav", "MH1420150004321"]]) {
  drivers.push((await call("POST", "/drivers", { name, phone: "98" + Math.floor(10000000 + Math.random() * 89999999), licence: { number: lic, class: "HPMV", expiryDate: day(drivers.length ? 25 : 700) } })).data);
}
const attendant = (await call("POST", "/drivers", { staffRole: "attendant", name: "Meena Kulkarni", phone: "9822011223" })).data;
const route1 = (await call("POST", "/routes", { name: "Kothrud – Campus Morning", code: "R1", plannedDistanceKm: 18.5, estimatedDurationMin: 55, startTime: "06:45", endTime: "07:50", stops: [
  { name: "Kothrud Depot", lat: 18.5074, lng: 73.8077, plannedArrival: "06:45" }, { name: "Karve Road", lat: 18.5018, lng: 73.8296, plannedArrival: "07:00" },
  { name: "Deccan Gymkhana", lat: 18.5167, lng: 73.8412, plannedArrival: "07:15" }, { name: "Greenfield Campus", lat: 18.5314, lng: 73.8446, plannedArrival: "07:45" } ] })).data;
const route2 = (await call("POST", "/routes", { name: "Baner – Campus Morning", code: "R2", plannedDistanceKm: 14, stops: [{ name: "Baner Gaon", lat: 18.559, lng: 73.7868 }, { name: "Aundh", lat: 18.5586, lng: 73.8077 }, { name: "Greenfield Campus", lat: 18.5314, lng: 73.8446 }] })).data;
await call("PATCH", `/routes/${route1._id}/active`, { active: true });
await call("PATCH", `/routes/${route2._id}/active`, { active: true });
await call("POST", `/vehicles/${vehicles[0]._id}/assign-driver`, { driverId: drivers[0]._id });

const kids = [];
for (const [n, pick] of [["Aarav Sharma", "Kothrud Depot"], ["Diya Kulkarni", "Karve Road"], ["Vihaan Deshmukh", "Kothrud Depot"], ["Ananya Joshi", "Deccan Gymkhana"], ["Ishaan Patil", "Karve Road"]]) {
  const p = (await call("POST", "/passengers", { name: n, kind: "student", identifier: "ADM" + (1000 + kids.length), grade: "Class " + (4 + kids.length), guardian: { name: "Parent of " + n.split(" ")[0], phone: "98200000" + (10 + kids.length) } })).data;
  await call("POST", `/passengers/${p._id}/assignments`, { route: route1._id, pickupStop: pick, dropStop: "Greenfield Campus" });
  kids.push(p);
}
const mkTrip = (b) => call("POST", "/trips", { route: route1._id, scheduledDate: today, durationMin: 60, ...b }).then((r) => r.data);
const t1 = await mkTrip({ departureTime: "06:45", vehicle: vehicles[0]._id, driver: drivers[0]._id, attendant: attendant._id, tripType: "morning" });
await call("POST", `/trips/${t1._id}/transition`, { to: "ready" });
await call("POST", `/trips/${t1._id}/transition`, { to: "in_progress" });
await call("POST", `/trips/${t1._id}/events`, { type: "stop_reached", stopSequence: 1 });
await call("POST", `/trips/${t1._id}/events`, { type: "passenger_boarded", passenger: kids[0]._id, stopSequence: 1 });
await call("POST", `/trips/${t1._id}/events`, { type: "passenger_boarded", passenger: kids[2]._id, stopSequence: 1 });
const t2 = await mkTrip({ route: route2._id, departureTime: "07:10", vehicle: vehicles[1]._id, driver: drivers[1]._id });
await mkTrip({ departureTime: "14:30", vehicle: vehicles[2]._id, tripType: "afternoon" });
await mkTrip({ scheduledDate: day(1), departureTime: "06:45", vehicle: vehicles[0]._id, driver: drivers[0]._id });
const t5 = await mkTrip({ scheduledDate: day(1), departureTime: "07:30", vehicle: vehicles[2]._id });
await call("POST", `/trips/${t5._id}/transition`, { to: "cancelled", reason: "School holiday" });

// live location from a registered tracker
const dev = (await call("POST", "/tracking/devices", { name: "Bus 1 tracker", vehicle: vehicles[0]._id })).data;
await fetch(B + "/tracking/ingest", { method: "POST", headers: { Authorization: `Device ${dev.publicId}:${dev.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ lat: 18.5115, lng: 73.8212, timestamp: new Date().toISOString(), speedKmh: 28, heading: 80 }) });

// costs, maintenance, documents
await call("POST", "/fuel", { vehicle: vehicles[0]._id, quantity: 60, pricePerUnit: 92.5, filledAt: new Date(Date.now() - 3 * 86400000).toISOString(), odometer: 48210, fullTank: true });
await call("POST", "/fuel", { vehicle: vehicles[0]._id, quantity: 55, pricePerUnit: 93, filledAt: new Date(Date.now() - 86400000).toISOString(), odometer: 48690, fullTank: true });
await call("POST", "/expenses", { category: "toll", amount: 240, date: new Date().toISOString(), vehicle: vehicles[0]._id, vendor: "Expressway toll" });
const m = (await call("POST", "/maintenance", { vehicle: vehicles[1]._id, type: "scheduled_service", issue: "10,000 km service", priority: "medium", scheduledDate: new Date(Date.now() + 2 * 86400000).toISOString(), workshop: "Shree Auto Works" })).data;
// requests
const drvUser = await call("POST", "/users", { name: "Ramesh Patil", email: "ramesh@greenfield.test", role: "driver", driver: drivers[0]._id });
await call("POST", "/users", { name: "Dina Dispatcher", email: "dina@greenfield.test", role: "dispatcher", phone: "9000000001" });
// billing
await call("POST", "/billing/fee-plans", { name: "Route 1 monthly fee", kind: "route", route: route1._id, amount: 180000, frequency: "monthly" });
await call("POST", "/billing/fee-plans", { name: "Deccan stop fee", kind: "stop", route: route1._id, stopName: "Deccan Gymkhana", amount: 210000, frequency: "monthly" });
await call("POST", "/billing/charges", { passenger: kids[1]._id, label: "Sibling discount", type: "discount", mode: "percent", value: 10 });
const gen = await call("POST", "/billing/invoices/generate", { period: new Date().toISOString().slice(0, 7), dueDate: new Date(Date.now() + 10 * 86400000).toISOString() });
const inv = (await call("GET", "/billing/invoices?limit=5")).data;
await call("POST", `/billing/invoices/${inv[0]._id}/payments`, { amount: 100000, method: "upi", reference: "UPI88231" });
console.log(JSON.stringify({ ok: true, invoices: gen.data.created.length, setPassword: drvUser.invite.link }));
