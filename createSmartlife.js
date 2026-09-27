// createSmartlife.js
var smartlifeDb = db.getSiblingDB("smartlife");
var smartlifePassword = typeof process !== "undefined" && process.env
  ? process.env.SMARTLIFE_DB_PASSWORD
  : "";

if (!smartlifePassword) {
  throw new Error("Set SMARTLIFE_DB_PASSWORD before running this script");
}

if (!smartlifeDb.getUser("smartlifeUser")) {
  smartlifeDb.createUser({
    user: "smartlifeUser",
    pwd: smartlifePassword,
    roles: [
      { role: "readWrite", db: "smartlife" },
      { role: "dbAdmin", db: "smartlife" }
    ]
  });
  print("smartlifeUser created");
} else {
  print("smartlifeUser already exists");
}
