// createSmartlife.js
var smartlifeDb = db.getSiblingDB("smartlife");

if (!smartlifeDb.getUser("smartlifeUser")) {
  smartlifeDb.createUser({
    user: "smartlifeUser",
    pwd: "SmartLifePass456",
    roles: [
      { role: "readWrite", db: "smartlife" },
      { role: "dbAdmin", db: "smartlife" }
    ]
  });
  print("smartlifeUser created");
} else {
  print("smartlifeUser already exists");
}
