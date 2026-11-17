const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("./config/env");

async function testToken(userId, email, role) {
  const token = jwt.sign({ id: userId, userId, role }, JWT_SECRET, { expiresIn: '1d' });
  const res = await fetch('http://localhost:5000/api/super-admin/plans', {
    headers: { Authorization: 'Bearer ' + token }
  });
  const data = await res.json();
  console.log(`User ${email} (ID ${userId}, Role ${role}): status=${res.status}`, data);
}

async function run() {
  await testToken(13, 'robert44004@gmail.com', 'USER');
  await testToken(10, 'robert442004@gmail.com', 'USER');
  await testToken(7, 'rohil@gmail.com', 'super_admin');
  await testToken(6, 'admin@gmail.com', 'ADMIN');
}
run();

