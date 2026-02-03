import { Router, Request, Response } from 'express';
import { getGlobalSettings, updateGlobalSettings, GlobalSettings } from '../db';

const router = Router();

// GET /api/settings - Get global settings
router.get('/', (req: Request, res: Response) => {
  try {
    const settings = getGlobalSettings();
    res.json(settings);
  } catch (error) {
    console.error('Error getting global settings:', error);
    res.status(500).json({ error: 'Failed to get global settings' });
  }
});

// PUT /api/settings - Update global settings
router.put('/', (req: Request, res: Response) => {
  try {
    const updates = req.body as Partial<GlobalSettings>;
    const settings = updateGlobalSettings(updates);
    console.log('[Settings] Updated global settings');
    res.json(settings);
  } catch (error) {
    console.error('Error updating global settings:', error);
    res.status(500).json({ error: 'Failed to update global settings' });
  }
});

// GET /api/settings/brightness-schedule - Get just the brightness schedule
router.get('/brightness-schedule', (req: Request, res: Response) => {
  try {
    const settings = getGlobalSettings();
    res.json(settings.brightnessSchedule);
  } catch (error) {
    console.error('Error getting brightness schedule:', error);
    res.status(500).json({ error: 'Failed to get brightness schedule' });
  }
});

// PUT /api/settings/brightness-schedule - Update just the brightness schedule
router.put('/brightness-schedule', (req: Request, res: Response) => {
  try {
    const brightnessSchedule = req.body;
    const settings = updateGlobalSettings({ brightnessSchedule });
    console.log('[Settings] Updated global brightness schedule');
    res.json(settings.brightnessSchedule);
  } catch (error) {
    console.error('Error updating brightness schedule:', error);
    res.status(500).json({ error: 'Failed to update brightness schedule' });
  }
});

export default router;
