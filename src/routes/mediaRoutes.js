const router=require('express').Router();const ctrl=require('../controllers/mediaController');router.get('/:token',ctrl.getAsset);module.exports=router;
