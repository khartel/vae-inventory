const { app, request } = require("./helpers");

test("GET /api/health remains public liveness", async () => {
  const result = await request(app).get("/api/health");
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ success: true, message: "Server is running" });
});

test("GET /api/ready checks PostgreSQL without requiring a session", async () => {
  const result = await request(app).get("/api/ready");
  expect(result.status).toBe(200);
  expect(result.body).toEqual({ success: true, message: "Database is ready", data: null });
});
