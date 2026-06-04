// Brand chrome shared by every transactional email. Templates pass inner
// content (`bodyHtml`) only; this wraps it in header + card + footer.
//
// Why it looks the way it does — email HTML is NOT web HTML:
//   • Layout uses <table>, not flex/grid — Gmail/Outlook strip modern layout.
//   • All styling is INLINE — <style> blocks are unreliable across clients.
//   • Brand mark is TEXT, not an <img> — clients block images by default, so
//     the design must look complete with images off. Swap to <img> later when
//     a hosted https logo exists.
// The output is a provider-neutral HTML string: any sender (SendGrid, SES,
// Mailgun, Postmark…) accepts it as the html body — nothing here is SendGrid-specific.

const BRAND = {
  name: "Blue",
  color: "#4f46e5", // indigo — header band + accents
  colorDark: "#4338ca", // gradient end / hover
  accentBg: "#eef2ff", // tinted code box
  accentBorder: "#c7d2fe",
  supportEmail: "support@blue.app",
};

export function wrapEmail({
  title,
  bodyHtml,
  preview,
}: {
  title: string;
  bodyHtml: string;
  preview?: string; // inbox snippet shown before the email is opened
}): string {
  const year = new Date().getFullYear();
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
</head>
<body style="margin:0;padding:0;background:#f3f4f6;-webkit-font-smoothing:antialiased;">
  ${
    preview
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${preview}</div>`
      : ""
  }
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f3f4f6;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(17,24,39,0.08);">

          <!-- header band -->
          <tr>
            <td style="background:${BRAND.color};background-image:linear-gradient(135deg,${BRAND.color} 0%,${BRAND.colorDark} 100%);padding:28px 32px;text-align:center;">
              <span style="font-family:'Segoe UI',Arial,sans-serif;font-size:22px;font-weight:700;letter-spacing:0.5px;color:#ffffff;">${BRAND.name}</span>
            </td>
          </tr>

          <!-- body -->
          <tr>
            <td style="padding:36px 32px 28px;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;font-weight:700;color:#111827;">${title}</h1>
              ${bodyHtml}
            </td>
          </tr>

          <!-- footer -->
          <tr>
            <td style="padding:22px 32px;background:#f9fafb;border-top:1px solid #f0f1f3;font-family:'Segoe UI',Arial,sans-serif;font-size:12px;line-height:1.6;color:#9ca3af;text-align:center;">
              Need help? <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.color};text-decoration:none;font-weight:600;">${BRAND.supportEmail}</a><br>
              © ${year} ${BRAND.name}. All rights reserved.
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
