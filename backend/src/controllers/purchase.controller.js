const service = require('../services/purchase.service');
const asyncHandler = require('../utils/asyncHandler');
const {
  sendSuccess
} = require('../utils/response.utils');
const handler = fn => asyncHandler(async (req, res) => sendSuccess(res, {
  data: await fn(req)
}));
exports.listSuppliers = handler(r => service.listSuppliers(r.params.businessId, r.validatedQuery));
exports.createSupplier = handler(r => service.saveSupplier(r.params.businessId, null, r.body, r.user));
exports.updateSupplier = handler(r => service.saveSupplier(r.params.businessId, r.params.id, r.body, r.user));
exports.archiveSupplier = handler(r => service.archiveSupplier(r.params.businessId, r.params.id, r.user));
exports.restoreSupplier = handler(r => service.archiveSupplier(r.params.businessId, r.params.id, r.user, true));
exports.listOrders = handler(r => service.listOrders(r.params.businessId, r.validatedQuery));
exports.getOrder = handler(r => service.getOrder(r.params.businessId, r.params.id));
exports.createOrder = handler(r => service.saveOrder(r.params.businessId, null, r.body, r.user));
exports.updateOrder = handler(r => service.saveOrder(r.params.businessId, r.params.id, r.body, r.user));
exports.transition = handler(r => service.transition(r.params.businessId, r.params.id, r.body, r.user));
exports.receive = handler(r => service.receive(r.params.businessId, r.params.id, r.body, r.user));
