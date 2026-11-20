const express = require('express');
const {
  authenticate
} = require('../middleware/auth.middleware');
const {
  authorize,
  belongsToBusiness
} = require('../middleware/role.middleware');
const {
  validate
} = require('../middleware/validate.middleware');
const c = require('../controllers/purchase.controller');
const v = require('../validators/purchase.validators');
const router = express.Router({
  mergeParams: true
});
router.use(authenticate, belongsToBusiness, authorize('SUPERADMIN', 'ADMIN'));
router.get('/suppliers', validate(v.list), c.listSuppliers);
router.post('/suppliers', validate(v.supplier), c.createSupplier);
router.patch('/suppliers/:id', validate(v.supplier), c.updateSupplier);
router.delete('/suppliers/:id', validate(v.param), c.archiveSupplier);
router.post('/suppliers/:id/restore', validate(v.param), c.restoreSupplier);
router.get('/orders', validate(v.list), c.listOrders);
router.post('/orders', validate(v.create), c.createOrder);
router.get('/orders/:id', validate(v.param), c.getOrder);
router.patch('/orders/:id', validate(v.update), c.updateOrder);
router.post('/orders/:id/status', validate(v.transition), c.transition);
router.post('/orders/:id/receive', validate(v.receive), c.receive);
module.exports = router;
