// createAdmin.js
var adminDb = db.getSiblingDB("admin");
var adminPassword = typeof process !== "undefined" && process.env
  ? process.env.SMARTLIFE_ADMIN_PASSWORD
  : "";

if (!adminPassword) {
  throw new Error("Set SMARTLIFE_ADMIN_PASSWORD before running this script");
}

if (!adminDb.getUser("adminUser")) {
  adminDb.createUser({
    user: "adminUser",
    pwd: adminPassword,
    roles: [ { role: "userAdminAnyDatabase", db: "admin" } ]
  });
  print("adminUser created");
} else {
  print("adminUser already exists");
}
