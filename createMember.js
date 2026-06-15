// createMember.js
var smartlifeDb = db.getSiblingDB("smartlife");

if (!smartlifeDb.getUser("memberUser")) {
  smartlifeDb.createUser({
    user: "memberUser",
    pwd: "MemberPass789",
    roles: [ { role: "readWrite", db: "smartlife" } ]
  });
  print("memberUser created");
} else {
  print("memberUser already exists");
}
