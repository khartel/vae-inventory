const request = require("supertest");
const app = require("../src/app");

const uniqueSuffix = () => `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Registers a new SuperAdmin, logs them in, and creates a business for them.
 * Returns the session cookie (for authenticated requests), the user, and the business.
 */
async function createSuperAdminWithBusiness(overrides = {}) {
  const suffix = uniqueSuffix();
  const username = overrides.username || `owner_${suffix}`;
  const password = overrides.password || "password123";

  await request(app).post("/api/auth/register").send({
    fullName: "Test Owner",
    username,
    phone: "08000000000",
    email: `${username}@example.com`,
    password,
  });

  const loginRes = await request(app).post("/api/auth/login").send({ username, password });
  const cookie = loginRes.headers["set-cookie"];

  const businessRes = await request(app)
    .post("/api/businesses")
    .set("Cookie", cookie)
    .send({
      name: `Business ${suffix}`,
      phone: "08011111111",
      country: "Nigeria",
      location: "Lagos",
      ...overrides.business,
    });

  return {
    cookie,
    user: loginRes.body.data.user,
    business: businessRes.body.data,
  };
}

/**
 * Adds an EMPLOYEE (or ADMIN) to a business (as its owner) and logs them in.
 * Returns their session cookie and user info.
 */
async function addAndLoginTeamMember(ownerCookie, businessId, role = "EMPLOYEE") {
  const suffix = uniqueSuffix();
  const username = `member_${suffix}`;

  const addRes = await request(app)
    .post(`/api/businesses/${businessId}/team`)
    .set("Cookie", ownerCookie)
    .send({
      fullName: "Test Team Member",
      username,
      phone: "08033333333",
      role,
    });

  const { defaultPassword } = addRes.body.data;

  const loginRes = await request(app)
    .post("/api/auth/login")
    .send({ username, password: defaultPassword });

  return {
    cookie: loginRes.headers["set-cookie"],
    user: loginRes.body.data.user,
    addResponse: addRes,
  };
}

module.exports = { app, request, createSuperAdminWithBusiness, addAndLoginTeamMember };
