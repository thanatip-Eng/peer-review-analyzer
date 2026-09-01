// api/lti-config.js
// -----------------------------------------------------------------------------
// serve IMS Basic LTI 1.1 configuration XML (สำหรับ Canvas "Configuration Type: By URL")
// ประกาศ placement course_navigation + privacy public + เปิดแท็บใหม่
// อาจารย์แค่วาง config URL นี้ใน Canvas ก็ได้เมนูใน Course Navigation ที่ยิง launch เดิม
// -----------------------------------------------------------------------------
export const config = { maxDuration: 10 };

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export default function handler(req, res) {
  const launchUrl = process.env.LTI_LAUNCH_URL;
  if (!launchUrl) {
    res.status(500).setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send('LTI_LAUNCH_URL env is not set');
  }
  const url = esc(launchUrl);
  // ชื่อเมนู/แอป — ตั้งเองได้ผ่าน query param ?label=... (ไม่ใส่ = ค่าเริ่มต้น)
  const rawLabel = typeof req.query?.label === 'string' && req.query.label.trim() ? req.query.label : 'ตรวจสอบผลอุทธรณ์คะแนน';
  const title = rawLabel;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<cartridge_basiclti_link xmlns="http://www.imsglobal.org/xsd/imslticc_v1p0"
    xmlns:blti="http://www.imsglobal.org/xsd/imsbasiclti_v1p0"
    xmlns:lticm="http://www.imsglobal.org/xsd/imslticm_v1p0"
    xmlns:lticp="http://www.imsglobal.org/xsd/imslticp_v1p0"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.imsglobal.org/xsd/imslticc_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticc_v1p0.xsd
    http://www.imsglobal.org/xsd/imsbasiclti_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imsbasiclti_v1p0.xsd
    http://www.imsglobal.org/xsd/imslticm_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticm_v1p0.xsd
    http://www.imsglobal.org/xsd/imslticp_v1p0 http://www.imsglobal.org/xsd/lti/ltiv1p0/imslticp_v1p0.xsd">
  <blti:title>${esc(title)}</blti:title>
  <blti:description>ติดตามสถานะและข้อความตอบกลับการอุทธรณ์คะแนน</blti:description>
  <blti:launch_url>${url}</blti:launch_url>
  <blti:extensions platform="canvas.instructure.com">
    <lticm:property name="privacy_level">public</lticm:property>
    <lticm:options name="course_navigation">
      <lticm:property name="url">${url}</lticm:property>
      <lticm:property name="text">${esc(title)}</lticm:property>
      <lticm:property name="visibility">public</lticm:property>
      <lticm:property name="default">enabled</lticm:property>
      <lticm:property name="enabled">true</lticm:property>
      <lticm:property name="windowTarget">_blank</lticm:property>
    </lticm:options>
  </blti:extensions>
  <cartridge_bundle identifierref="BLTI001_Bundle"/>
  <cartridge_icon identifierref="BLTI001_Icon"/>
</cartridge_basiclti_link>`;

  res.status(200).setHeader('Content-Type', 'application/xml; charset=utf-8');
  return res.send(xml);
}
