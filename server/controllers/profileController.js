const Profile = require('../models/Profile');
const Like = require('../models/Like');
const { resolveUserId, writeLog, sanitizeRegex } = require('../utils/helpers');

async function listProfiles(req, res) {
  try {
    const resolvedUserId = await resolveUserId(req.query.userId, req.session);
    if (!resolvedUserId) return res.status(400).json({ error: 'User ID is required.' });

    const profiles = await Profile.find({ userId: resolvedUserId }).sort({ createdAt: 1 }).lean();
    const payload = profiles.map((p) => ({
      id: String(p._id),
      userId: String(p.userId),
      name: p.name,
      avatar: p.avatar,
      likedContent: p.likedContent || [],
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    await writeLog({
      event: 'profiles_load',
      userId: resolvedUserId,
      details: { profileCount: payload.length, profileNames: payload.map((p) => p.name) },
    });

    return res.json(payload);
  } catch (err) {
    console.error('Error reading profiles:', err);
    await writeLog({ level: 'error', event: 'profiles_load', details: { error: err.message } });
    return res.status(500).json({ error: 'Failed to load profiles.' });
  }
}

async function createProfile(req, res) {
  try {
    const userIdResolved = await resolveUserId(req.body?.userId, req.session);
    const name = String(req.body?.name || '').trim();
    const avatar = String(req.body?.avatar || '').trim();

    if (!userIdResolved || !name || !avatar) {
      return res.status(400).json({ error: 'User ID, name, and avatar are required.' });
    }
    if (name.length < 2) {
      return res.status(400).json({ error: 'Profile name must be at least 2 characters.' });
    }
    if (name.length > 20) {
      return res.status(400).json({ error: 'Profile name must be at most 20 characters.' });
    }

    const count = await Profile.countDocuments({ userId: userIdResolved });
    if (count >= 5) {
      return res.status(400).json({ error: 'Maximum of 5 profiles per user.' });
    }

    const dup = await Profile.exists({
      userId: userIdResolved,
      name: new RegExp(`^${sanitizeRegex(name)}$`, 'i'),
    });
    if (dup) return res.status(409).json({ error: 'Profile name already exists.' });

    const doc = await Profile.create({ userId: userIdResolved, name, avatar });

    await writeLog({
      event: 'profile_create',
      userId: userIdResolved,
      profileId: String(doc._id),
      details: { profileId: String(doc._id), profileName: name, avatar },
    });

    return res.status(201).json({
      id: String(doc._id),
      userId: String(doc.userId),
      name: doc.name,
      avatar: doc.avatar,
      likedContent: doc.likedContent || [],
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    });
  } catch (err) {
    console.error('Error creating profile:', err);
    return res.status(500).json({ error: 'Failed to create profile.' });
  }
}

async function updateProfile(req, res) {
  try {
    const profileId = String(req.params.id);
    const userIdResolved = await resolveUserId(req.body?.userId, req.session);
    const name = String(req.body?.name || '').trim();
    const avatar = String(req.body?.avatar || '').trim();

    if (!userIdResolved) return res.status(400).json({ error: 'User ID is required.' });
    if (!name || !avatar) return res.status(400).json({ error: 'Name and avatar are required.' });
    if (name.length < 2) return res.status(400).json({ error: 'Profile name must be at least 2 characters.' });
    if (name.length > 20) return res.status(400).json({ error: 'Profile name must be at most 20 characters.' });

    const profile = await Profile.findById(profileId);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    if (String(profile.userId) !== String(userIdResolved)) {
      return res.status(403).json({ error: 'Not authorized to edit this profile.' });
    }

    const dup = await Profile.exists({
      _id: { $ne: profile._id },
      userId: userIdResolved,
      name: new RegExp(`^${sanitizeRegex(name)}$`, 'i'),
    });
    if (dup) return res.status(409).json({ error: 'Profile name already exists.' });

    profile.name = name;
    profile.avatar = avatar;
    await profile.save();

    await writeLog({
      event: 'profile_update',
      userId: userIdResolved,
      profileId: String(profileId),
      details: { profileId: String(profileId), profileName: name, avatar },
    });

    return res.json({
      id: String(profile._id),
      userId: String(profile.userId),
      name: profile.name,
      avatar: profile.avatar,
      likedContent: profile.likedContent || [],
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    return res.status(500).json({ error: 'Failed to update profile.' });
  }
}

async function deleteProfile(req, res) {
  try {
    const profileId = String(req.params.id);
    const userIdResolved = req.session?.userId;
    if (!userIdResolved) {
      return res.status(401).json({ error: 'Authentication required.' });
    }

    const profile = await Profile.findById(profileId);
    if (!profile) return res.status(404).json({ error: 'Profile not found.' });
    if (String(profile.userId) !== String(userIdResolved)) {
      return res.status(403).json({ error: 'Not authorized to delete this profile.' });
    }

    await Like.deleteMany({ profileId: String(profileId) });
    await Profile.deleteOne({ _id: profileId });

    await writeLog({
      event: 'profile_delete',
      userId: userIdResolved,
      profileId: String(profileId),
      details: { profileId: String(profileId), profileName: profile.name, avatar: profile.avatar },
    });

    return res.json({ ok: true, message: 'Profile deleted successfully.' });
  } catch (err) {
    console.error('Error deleting profile:', err);
    return res.status(500).json({ error: 'Failed to delete profile.' });
  }
}

module.exports = {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
};
