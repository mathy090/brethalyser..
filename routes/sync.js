const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { syncOfflineRecords, getUnsyncedRecords } = require('../controllers/syncController');

router.use(protect);
router.post('/', syncOfflineRecords);
router.get('/unsynced', getUnsyncedRecords);

module.exports = router;
