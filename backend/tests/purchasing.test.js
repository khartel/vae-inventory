const {
  randomUUID
} = require('crypto');
const {
  app,
  request,
  createSuperAdminWithBusiness,
  addAndLoginTeamMember
} = require('./helpers');
const prisma = require('../src/utils/prisma');
async function fixture() {
  const owner = await createSuperAdminWithBusiness();
  const businessId = owner.business.id;
  const warehouse = (await prisma.warehouse.findFirst({
    where: {
      businessId,
      deletedAt: null
    }
  })) || (await prisma.warehouse.create({
    data: {
      businessId,
      name: 'Test receiving',
      isPrimary: true
    }
  }));
  const product = await prisma.product.create({
    data: {
      businessId,
      name: 'Test product',
      unit: 'pcs',
      price: 40,
      costPrice: 5
    }
  });
  const supplier = await prisma.supplier.create({
    data: {
      businessId,
      name: 'Test supplier',
      phone: '+233241234567',
      address: 'Test address'
    }
  });
  const base = `/api/businesses/${businessId}/purchasing`;
  const send = (method, path, body, cookie = owner.cookie) => request(app)[method](base + path).set('Cookie', cookie).send(body);
  const draft = await send('post', '/orders', {
    supplierId: supplier.id,
    warehouseId: warehouse.id,
    items: [{
      productId: product.id,
      quantity: 10,
      unitCost: 12.5
    }]
  });
  expect(draft.status).toBe(200);
  return {
    owner,
    businessId,
    warehouse,
    product,
    supplier,
    send,
    draft: draft.body.data
  };
}
describe('Purchasing workflow', () => {
  test('partial/full receipts update stock and latest cost once, preserve history and reject over-receipts', async () => {
    const f = await fixture();
    const {
      send
    } = f;
    expect(await prisma.warehouseStock.count({
      where: {
        productId: f.product.id
      }
    })).toBe(0);
    let res = await send('post', `/orders/${f.draft.id}/status`, {
      action: 'ORDER',
      version: 0
    });
    expect(res.status).toBe(200);
    let o = res.body.data;
    const first = {
      version: o.version,
      requestId: randomUUID(),
      items: [{
        orderItemId: o.items[0].id,
        quantity: 4
      }]
    };
    res = await send('post', `/orders/${o.id}/receive`, first);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PARTIALLY_RECEIVED');
    o = res.body.data;
    expect(o.receivedAmount).toBe(50);
    res = await send('post', `/orders/${o.id}/receive`, first);
    expect(res.status).toBe(200);
    expect(res.body.data.receipts.length).toBe(1);
    expect((await prisma.product.findUnique({
      where: {
        id: f.product.id
      }
    })).costPrice).toBe(12.5);
    res = await send('post', `/orders/${o.id}/receive`, {
      ...first,
      items: [{
        orderItemId: o.items[0].id,
        quantity: 5
      }]
    });
    expect(res.status).toBe(409);
    res = await send('post', `/orders/${o.id}/receive`, {
      version: o.version,
      requestId: randomUUID(),
      items: [{
        orderItemId: o.items[0].id,
        quantity: 7
      }]
    });
    expect(res.status).toBe(400);
    expect((await prisma.warehouseStock.findFirst({
      where: {
        productId: f.product.id
      }
    })).quantity).toBe(4);
    res = await send('post', `/orders/${o.id}/receive`, {
      version: o.version,
      requestId: randomUUID(),
      items: [{
        orderItemId: o.items[0].id,
        quantity: 6
      }]
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RECEIVED');
    expect(res.body.data.totalAmount).toBe(125);
    expect(res.body.data.receipts.length).toBe(2);
    expect((await prisma.warehouseStock.findFirst({
      where: {
        productId: f.product.id
      }
    })).quantity).toBe(10);
    expect(await prisma.stockMovement.count({
      where: {
        productId: f.product.id,
        type: 'RESTOCK'
      }
    })).toBe(2);
    expect(await prisma.auditLog.count({
      where: {
        entityId: o.id,
        action: 'PURCHASE_RECEIVED'
      }
    })).toBe(2);
  });
  test('two concurrent deliveries cannot over-receive the same purchase', async () => {
    const f = await fixture();
    const ordered = (await f.send('post', `/orders/${f.draft.id}/status`, {
      action: 'ORDER',
      version: 0
    })).body.data;
    const responses = await Promise.all([1, 2].map(() => f.send('post', `/orders/${ordered.id}/receive`, {
      version: ordered.version,
      requestId: randomUUID(),
      items: [{
        orderItemId: ordered.items[0].id,
        quantity: 10
      }]
    })));
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.every(r => [200, 409].includes(r.status))).toBe(true);
    expect((await prisma.warehouseStock.findFirst({
      where: {
        productId: f.product.id
      }
    })).quantity).toBe(10);
    expect(await prisma.purchaseReceipt.count({
      where: {
        orderId: ordered.id
      }
    })).toBe(1);
  });
  test('scopes orders, supplier writes and product references to the business, and denies employees', async () => {
    const f = await fixture();
    const other = await createSuperAdminWithBusiness();
    const member = await addAndLoginTeamMember(f.owner.cookie, f.businessId);
    expect((await f.send('get', '/orders', undefined, member.cookie)).status).toBe(403);
    expect((await f.send('get', `/orders/${f.draft.id}`, undefined, other.cookie)).status).toBe(403);
    const alien = await prisma.product.create({
      data: {
        businessId: other.business.id,
        name: 'Other product',
        unit: 'pcs'
      }
    });
    expect((await f.send('post', '/orders', {
      supplierId: f.supplier.id,
      warehouseId: f.warehouse.id,
      items: [{
        productId: alien.id,
        quantity: 1,
        unitCost: 1
      }]
    })).status).toBe(400);
    expect((await f.send('patch', `/suppliers/${randomUUID()}`, {
      name: 'X',
      phone: '+233241234567',
      address: 'X'
    })).status).toBe(404);
    expect((await f.send('post', '/orders', {
      supplierId: f.supplier.id,
      warehouseId: f.warehouse.id,
      items: [{
        productId: f.product.id,
        quantity: -1,
        unitCost: 1
      }]
    })).status).toBe(400);
  });
  test('draft edits use versions, supplier archive is reversible, and cancellation preserves received stock', async () => {
    const f = await fixture();
    const input = {
      supplierId: f.supplier.id,
      warehouseId: f.warehouse.id,
      items: [{
        productId: f.product.id,
        quantity: 8,
        unitCost: 3
      }],
      version: 0
    };
    let res = await f.send('patch', `/orders/${f.draft.id}`, input);
    expect(res.status).toBe(200);
    expect(res.body.data.totalAmount).toBe(24);
    expect((await f.send('patch', `/orders/${f.draft.id}`, input)).status).toBe(409);
    await f.send('delete', `/suppliers/${f.supplier.id}`);
    expect((await f.send('post', `/orders/${f.draft.id}/status`, {
      action: 'ORDER',
      version: 1
    })).status).toBe(400);
    await f.send('post', `/suppliers/${f.supplier.id}/restore`);
    res = await f.send('post', `/orders/${f.draft.id}/status`, {
      action: 'ORDER',
      version: 1
    });
    expect(res.status).toBe(200);
    let o = res.body.data;
    res = await f.send('post', `/orders/${o.id}/receive`, {
      version: o.version,
      requestId: randomUUID(),
      items: [{
        orderItemId: o.items[0].id,
        quantity: 2
      }]
    });
    o = res.body.data;
    expect(res.status).toBe(200);
    res = await f.send('post', `/orders/${o.id}/status`, {
      action: 'CANCEL',
      version: o.version
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect((await prisma.warehouseStock.findFirst({
      where: {
        productId: f.product.id
      }
    })).quantity).toBe(2);
    expect((await f.send('post', `/orders/${o.id}/receive`, {
      version: res.body.data.version,
      requestId: randomUUID(),
      items: [{
        orderItemId: o.items[0].id,
        quantity: 1
      }]
    })).status).toBe(409);
  });
});
