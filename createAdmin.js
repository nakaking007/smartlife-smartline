// createAdmin.js
var adminDb = db.getSiblingDB("admin");

if (!adminDb.getUser("adminUser")) {
  adminDb.createUser({
    user: "adminUser",
    pwd: "StrongPassword123",
    roles: [ { role: "userAdminAnyDatabase", db: "admin" } ]
  });
  print("adminUser created");
} else {
  print("adminUser already exists");
}
