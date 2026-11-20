const {
  z
} = require('zod');
const {
  isValidPhoneNumber
} = require('libphonenumber-js');
const params = z.object({
  businessId: z.uuid(),
  id: z.uuid().optional()
});
const quantity = z.number().finite().positive().max(1e9).multipleOf(0.0001);
const cost = z.number().finite().min(0).max(1e9).multipleOf(0.0001);
const unique = key => items => new Set(items.map(i => i[key])).size === items.length;
const supplierBody = z.object({
  name: z.string().trim().min(1).max(200),
  phone: z.string().trim().refine(isValidPhoneNumber, 'Enter a valid phone number'),
  address: z.string().trim().min(1).max(1000),
  email: z.union([z.email(), z.literal('')]).optional()
});
const orderBody = z.object({
  supplierId: z.uuid(),
  warehouseId: z.uuid(),
  notes: z.string().trim().max(2000).optional(),
  expectedAt: z.iso.datetime().nullable().optional(),
  items: z.array(z.object({
    productId: z.uuid(),
    quantity,
    unitCost: cost
  })).min(1).max(100).refine(unique('productId'), 'Each product can only be added once')
}).refine(v => v.items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0) <= 1e12, 'Order total exceeds the supported limit');
const listQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).default(''),
  status: z.enum(['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(),
  archived: z.enum(['true', 'false']).default('false')
});
module.exports = {
  list: {
    params,
    query: listQuery
  },
  param: {
    params
  },
  supplier: {
    params,
    body: supplierBody
  },
  create: {
    params,
    body: orderBody
  },
  update: {
    params,
    body: orderBody.safeExtend({
      version: z.number().int().min(0)
    })
  },
  transition: {
    params,
    body: z.object({
      action: z.enum(['ORDER', 'CANCEL']),
      version: z.number().int().min(0)
    })
  },
  receive: {
    params,
    body: z.object({
      requestId: z.uuid(),
      version: z.number().int().min(0),
      items: z.array(z.object({
        orderItemId: z.uuid(),
        quantity
      })).min(1).max(100).refine(unique('orderItemId'), 'Each item can only be received once per submission')
    })
  }
};
