const router=require('express').Router();
const { protect, authorize }=require('../middleware/auth');
const ctrl=require('../controllers/advancedAnalyticsController');
router.use(protect,authorize('admin','super_admin','teacher'));
router.get('/summary',ctrl.summary);
router.get('/export.csv',ctrl.csv);
router.get('/export.xlsx',ctrl.xlsx);
router.get('/export.pdf',ctrl.pdf);
module.exports=router;
