const { MediaAsset } = require('../models');

exports.getAsset = async (req, res) => {
  try {
    const asset = await MediaAsset.findOne({ where: { token: req.params.token, isActive: true }, skipTenantScope: true });
    if (!asset) return res.status(404).send('Media not found');

    const metadata = asset.metadata || {};
    const externalUrl = asset.externalUrl || metadata.externalUrl || metadata.cloudinary?.secureUrl || metadata.cloudinary?.url || null;
    if (externalUrl) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      return res.redirect(302, externalUrl);
    }

    const raw = asset.data ? Buffer.from(asset.data) : Buffer.alloc(0);
    if (!raw.length) return res.status(410).send('Media data is unavailable. Please re-upload this asset.');
    const etag = `"${asset.checksum}"`;
    if (req.headers['if-none-match'] === etag) return res.status(304).end();
    const mimeType = String(asset.mimeType || 'application/octet-stream').toLowerCase();
    const inlineSafe = /^image\/(png|jpeg|webp|gif)$/.test(mimeType) || mimeType === 'application/pdf';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', String(asset.byteSize || raw.length));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', etag);
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    if (!inlineSafe) {
      const safeName = String(asset.originalName || 'download').replace(/[\r\n"\\]/g, '_').slice(0, 160);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
    }
    return res.end(raw);
  } catch (error) {
    console.error('Media read error:', error);
    return res.status(500).send('Media unavailable');
  }
};
