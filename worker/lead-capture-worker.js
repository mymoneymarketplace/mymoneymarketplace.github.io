// Cloudflare Worker: lead capture for mymoneymarketplace.github.io
// POST endpoint that (1) fires the Zapier webhook -> GHL contact, and
// (2) sends a segmented welcome email via Resend. Returns 200 on success.
//
// Deploy: see worker/README.md. Secrets are set via `wrangler secret put`
// so no credentials live in source.

export default {
  async fetch(request, env) {

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
          'Access-Control-Allow-Methods': 'POST',
          'Access-Control-Allow-Headers': 'Content-Type',
        }
      })
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }

    try {
      const data = await request.json()

      if (!data.email || !data.firstName) {
        return new Response(
          JSON.stringify({ error: 'Missing required fields' }),
          { status: 400, headers: corsHeaders(env) }
        )
      }

      const leadInfo = parseLeadType(data.referrerPage || '')

      let zapierStatus = 'not fired'
      let resendStatus = 'not fired'
      let resendBody = {}

      // Fire Zapier
      try {
        const zapierRes = await fetch(env.ZAPIER_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: data.firstName,
            email: data.email,
            leadType: leadInfo.leadType,
            specificNeed: leadInfo.specificNeed,
            profession: leadInfo.profession,
            city: leadInfo.city,
            referrerPage: data.referrerPage,
            utmCampaign: data.utmCampaign || '',
            tag1: leadInfo.tags[0] || '',
            tag2: leadInfo.tags[1] || '',
            tag3: leadInfo.tags[2] || '',
            tagsString: leadInfo.tags.join(','),
            primaryTag: leadInfo.leadType,
            secondaryTag: leadInfo.specificNeed,
            professionTag: leadInfo.profession || '',
            cityTag: leadInfo.city || '',
            timestamp: new Date().toISOString()
          })
        })
        zapierStatus = zapierRes.status
      } catch(e) {
        zapierStatus = 'ERROR: ' + e.message
      }

      // Fire Resend
      try {
        const resendRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: env.FROM_EMAIL,
            to: data.email,
            subject: getSubject(leadInfo, data.firstName),
            html: getEmailTemplate(leadInfo, data.firstName)
          })
        })
        resendBody = await resendRes.json()
        resendStatus = resendRes.status
      } catch(e) {
        resendStatus = 'ERROR: ' + e.message
        resendBody = { message: e.message }
      }

      return new Response(
        JSON.stringify({
          success: true,
          debug: {
            zapier: zapierStatus,
            resend: resendStatus,
            resendResponse: resendBody,
            leadType: leadInfo.leadType,
            specificNeed: leadInfo.specificNeed,
            fromEmail: env.FROM_EMAIL
          }
        }),
        { status: 200, headers: corsHeaders(env) }
      )

    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Server error', message: error.message }),
        { status: 500, headers: corsHeaders(env) }
      )
    }
  }
}

function corsHeaders(env) {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN
  }
}

function parseLeadType(path) {
  const p = path.toLowerCase()

  // Business loans city pages
  if (p.includes('business-loans-')) {
    const cityMatch = p.match(/business-loans-([a-z-]+)-([a-z]{2})/)
    return {
      leadType: 'business-loans',
      specificNeed: 'working-capital',
      profession: '',
      city: cityMatch ? cityMatch[1] : '',
      tags: ['mmm-lead', 'business-loans']
    }
  }

  // Personal loans - bad credit
  if (p.includes('bad-credit')) {
    return {
      leadType: 'personal-loans',
      specificNeed: 'bad-credit',
      profession: '',
      city: '',
      tags: ['mmm-lead', 'personal-loans', 'bad-credit']
    }
  }

  // Personal loans - debt consolidation
  if (p.includes('debt-consolidation')) {
    return {
      leadType: 'personal-loans',
      specificNeed: 'debt-consolidation',
      profession: '',
      city: '',
      tags: ['mmm-lead', 'personal-loans', 'debt-consolidation']
    }
  }

  // Personal loans - home improvement
  if (p.includes('home-improvement')) {
    return {
      leadType: 'personal-loans',
      specificNeed: 'home-improvement',
      profession: '',
      city: '',
      tags: ['mmm-lead', 'personal-loans', 'home-improvement']
    }
  }

  // Personal loans - same day
  if (p.includes('same-day')) {
    return {
      leadType: 'personal-loans',
      specificNeed: 'same-day',
      profession: '',
      city: '',
      tags: ['mmm-lead', 'personal-loans', 'same-day-loan']
    }
  }

  // Credit cards - profession pages
  if (p.includes('credit-cards-for-nurses')) {
    return {
      leadType: 'credit-cards',
      specificNeed: 'cash-back',
      profession: 'nurses',
      city: '',
      tags: ['mmm-lead', 'credit-cards', 'nurses']
    }
  }

  if (p.includes('credit-cards-for-truck-drivers')) {
    return {
      leadType: 'credit-cards',
      specificNeed: 'gas-rewards',
      profession: 'truck-drivers',
      city: '',
      tags: ['mmm-lead', 'credit-cards', 'truck-drivers']
    }
  }

  if (p.includes('credit-cards-for-doctors')) {
    return {
      leadType: 'credit-cards',
      specificNeed: 'premium',
      profession: 'doctors',
      city: '',
      tags: ['mmm-lead', 'credit-cards', 'doctors']
    }
  }

  if (p.includes('credit-cards-for-freelancers')) {
    return {
      leadType: 'credit-cards',
      specificNeed: 'business',
      profession: 'freelancers',
      city: '',
      tags: ['mmm-lead', 'credit-cards', 'freelancers']
    }
  }

  // Credit cards - category pages
  if (p.includes('cash-back')) {
    return {
      leadType: 'credit-cards',
      specificNeed: 'cash-back',
      profession: '',
      city: '',
      tags: ['mmm-lead', 'credit-cards', 'cash-back']
    }
  }

  if (p.includes('travel-rewards')) {
    return {
      leadType: 'credit-cards',
      specificNeed: 'travel',
      profession: '',
      city: '',
      tags: ['mmm-lead', 'credit-cards', 'travel-rewards']
    }
  }

  if (p.includes('business-credit-cards') ||
      p.includes('credit-cards/business')) {
    return {
      leadType: 'credit-cards',
      specificNeed: 'business',
      profession: '',
      city: '',
      tags: ['mmm-lead', 'credit-cards', 'business-cards']
    }
  }

  // Default fallback
  return {
    leadType: 'general',
    specificNeed: 'general',
    profession: '',
    city: '',
    tags: ['mmm-lead']
  }
}

function getSubject(leadInfo, firstName) {
  const subjects = {
    'bad-credit': `Your free loan guide is inside, ${firstName}`,
    'debt-consolidation': `Your debt consolidation guide, ${firstName}`,
    'home-improvement': `Fund your home project \u2014 guide inside`,
    'same-day': `Fast loan options for you, ${firstName}`,
    'business-loans': `Business funding options, ${firstName}`,
    'cash-back': `Your cash back card guide, ${firstName}`,
    'travel': `Your travel rewards guide, ${firstName}`,
    'business': `Best business cards for you, ${firstName}`,
    'nurses': `Best cards for nurses \u2014 your guide, ${firstName}`,
    'truck-drivers': `Top gas reward cards for drivers, ${firstName}`,
    'doctors': `Premium cards for physicians, ${firstName}`,
    'freelancers': `Best cards for freelancers, ${firstName}`,
  }
  return subjects[leadInfo.specificNeed] ||
    subjects[leadInfo.profession] ||
    `Your free financial guide, ${firstName}`
}

function getEmailTemplate(leadInfo, firstName) {

  const baseStyle = `
    font-family: Arial, Helvetica, sans-serif;
    max-width: 600px;
    margin: 0 auto;
    background: #ffffff;
  `

  const header = `
    <div style="background:#ffffff;padding:24px;text-align:center;border-bottom:3px solid #008254;">
      <img src="https://assets.cdn.filesafe.space/ViERfxWPyzGokVuzinGu/media/69ded38080b446d0fb84f50e.png"
           alt="My Money Marketplace" style="height:40px;width:auto;">
    </div>
  `

  const footer = `
    <div style="background:#f7f7f7;padding:24px;text-align:center;margin-top:32px;">
      <p style="font-size:12px;color:#717171;margin:0 0 8px;">
        My Money Marketplace &middot; mymoneymarketplace.com
      </p>
      <p style="font-size:11px;color:#999999;margin:0;">
        You received this because you requested our free guide.
        <a href="[UNSUBSCRIBE]" style="color:#008254;">Unsubscribe</a>
      </p>
    </div>
  `

  const greenButton = (text, url) => `
    <div style="text-align:center;margin:24px 0;">
      <a href="${url}"
         style="background:#008254;color:#ffffff;
                padding:14px 32px;border-radius:6px;
                text-decoration:none;font-size:15px;
                font-weight:bold;display:inline-block;">
        ${text}
      </a>
    </div>
  `

  const trustNote = `
    <p style="font-size:12px;color:#717171;
              text-align:center;margin:8px 0 24px;">
      Free to check &middot; Won't affect your credit score &middot; No obligation
    </p>
  `

  // BAD CREDIT TEMPLATE
  if (leadInfo.specificNeed === 'bad-credit') {
    return `
      <div style="${baseStyle}">
        ${header}
        <div style="background:#f0faf5;padding:32px 24px;text-align:center;">
          <h1 style="font-family:Georgia,serif;font-size:24px;
                     color:#111111;margin:0 0 8px;">
            Your Free Guide Is Inside, ${firstName}
          </h1>
          <p style="font-size:15px;color:#444444;margin:0;">
            5 Ways to Get Approved for a Personal Loan
            (Even With Bad Credit)
          </p>
        </div>
        <div style="padding:32px 24px;">
          <div style="border:1px solid #c3e6d5;
                      border-radius:8px;padding:20px;
                      text-align:center;margin-bottom:24px;">
            <p style="font-size:14px;color:#444444;margin:0 0 12px;">
              Your guide is ready to download
            </p>
            ${greenButton(
              'Download Your Free Guide &rarr;',
              'https://mymoneymarketplace.github.io/guides/personal-loans-guide.pdf'
            )}
          </div>
          <hr style="border:none;border-top:1px solid #e2e2e2;margin:24px 0;">
          <h2 style="font-family:Georgia,serif;font-size:20px;
                     color:#111111;margin:0 0 12px;">
            Ready to Check Your Rate?
          </h2>
          <p style="font-size:15px;color:#444444;line-height:1.6;margin:0 0 16px;">
            It takes 2 minutes and won't affect your credit score.
            Lendmate Capital accepts scores starting at 550.
          </p>
          <table style="width:100%;margin:0 0 16px;">
            <tr>
              <td style="text-align:center;padding:12px;">
                <strong style="font-size:20px;color:#008254;display:block;">550+</strong>
                <span style="font-size:12px;color:#717171;">Min Score</span>
              </td>
              <td style="text-align:center;padding:12px;">
                <strong style="font-size:20px;color:#008254;display:block;">2 Min</strong>
                <span style="font-size:12px;color:#717171;">Rate Check</span>
              </td>
              <td style="text-align:center;padding:12px;">
                <strong style="font-size:20px;color:#008254;display:block;">24hr</strong>
                <span style="font-size:12px;color:#717171;">Funding</span>
              </td>
            </tr>
          </table>
          ${greenButton(
            'Check My Rate &mdash; No Hard Pull &rarr;',
            'https://lendmatecapital.com?utm_source=email&utm_medium=nurture&utm_campaign=bad-credit-welcome&utm_content=email-cta'
          )}
          ${trustNote}
        </div>
        ${footer}
      </div>
    `
  }

  // DEBT CONSOLIDATION TEMPLATE
  if (leadInfo.specificNeed === 'debt-consolidation') {
    return `
      <div style="${baseStyle}">
        ${header}
        <div style="background:#f0f4f8;padding:32px 24px;text-align:center;">
          <h1 style="font-family:Georgia,serif;font-size:24px;
                     color:#111111;margin:0 0 8px;">
            Your Debt Consolidation Guide, ${firstName}
          </h1>
          <p style="font-size:15px;color:#444444;margin:0 0 16px;">
            The Complete Guide to Debt Consolidation
          </p>
          <div style="background:#ffffff;border-radius:8px;
                      padding:16px;display:inline-block;">
            <strong style="font-size:28px;color:#008254;">$4,200+</strong>
            <p style="font-size:12px;color:#717171;margin:4px 0 0;">
              Average savings consolidating $15K in CC debt
            </p>
          </div>
        </div>
        <div style="padding:32px 24px;">
          ${greenButton(
            'Download Your Free Guide &rarr;',
            'https://mymoneymarketplace.github.io/guides/debt-consolidation-guide.pdf'
          )}
          <hr style="border:none;border-top:1px solid #e2e2e2;margin:24px 0;">
          <h2 style="font-family:Georgia,serif;font-size:20px;
                     color:#111111;margin:0 0 16px;">
            See How Much You Could Save
          </h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
            <tr style="background:#f7f7f7;">
              <th style="padding:10px;text-align:left;
                         font-size:13px;color:#717171;
                         border-bottom:1px solid #e2e2e2;"></th>
              <th style="padding:10px;text-align:center;
                         font-size:13px;color:#e63946;
                         border-bottom:1px solid #e2e2e2;">Before</th>
              <th style="padding:10px;text-align:center;
                         font-size:13px;color:#008254;
                         border-bottom:1px solid #e2e2e2;">After</th>
            </tr>
            <tr>
              <td style="padding:10px;font-size:14px;color:#444444;
                         border-bottom:1px solid #f0f0f0;">Payments</td>
              <td style="padding:10px;text-align:center;font-size:14px;
                         color:#e63946;border-bottom:1px solid #f0f0f0;">4 separate</td>
              <td style="padding:10px;text-align:center;font-size:14px;
                         color:#008254;border-bottom:1px solid #f0f0f0;">1 payment</td>
            </tr>
            <tr>
              <td style="padding:10px;font-size:14px;color:#444444;
                         border-bottom:1px solid #f0f0f0;">Avg Rate</td>
              <td style="padding:10px;text-align:center;font-size:14px;
                         color:#e63946;border-bottom:1px solid #f0f0f0;">~22% APR</td>
              <td style="padding:10px;text-align:center;font-size:14px;
                         color:#008254;border-bottom:1px solid #f0f0f0;">As low as ~12%</td>
            </tr>
            <tr>
              <td style="padding:10px;font-size:14px;color:#444444;">
                Total Interest</td>
              <td style="padding:10px;text-align:center;font-size:14px;
                         color:#e63946;">~$7,840</td>
              <td style="padding:10px;text-align:center;font-size:14px;
                         color:#008254;">~$3,116</td>
            </tr>
          </table>
          ${greenButton(
            'See My Consolidation Rate &rarr;',
            'https://lendmatecapital.com?utm_source=email&utm_medium=nurture&utm_campaign=debt-consolidation-welcome&utm_content=email-cta'
          )}
          ${trustNote}
        </div>
        ${footer}
      </div>
    `
  }

  // BUSINESS LOANS TEMPLATE
  if (leadInfo.leadType === 'business-loans') {
    const cityText = leadInfo.city ?
      ` in ${leadInfo.city.charAt(0).toUpperCase() + leadInfo.city.slice(1)}` : ''
    return `
      <div style="${baseStyle}">
        ${header}
        <div style="background:#f0f4f8;padding:32px 24px;text-align:center;">
          <h1 style="font-family:Georgia,serif;font-size:24px;
                     color:#111111;margin:0 0 8px;">
            Business Funding Options${cityText}, ${firstName}
          </h1>
          <p style="font-size:15px;color:#444444;margin:0;">
            From $5,000 to $5,000,000 &mdash; same-day decisions
          </p>
        </div>
        <div style="padding:32px 24px;">
          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
            <tr>
              <td style="padding:12px;text-align:center;
                         border:1px solid #e2e2e2;border-radius:8px;">
                <strong style="font-size:14px;color:#111111;display:block;">
                  SBA Loans
                </strong>
                <span style="font-size:12px;color:#717171;">
                  Lowest rates, govt-backed
                </span>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:12px;text-align:center;
                         border:1px solid #e2e2e2;border-radius:8px;">
                <strong style="font-size:14px;color:#111111;display:block;">
                  Equipment Financing
                </strong>
                <span style="font-size:12px;color:#717171;">
                  Finance what you need
                </span>
              </td>
            </tr>
            <tr><td colspan="3" style="height:8px;"></td></tr>
            <tr>
              <td style="padding:12px;text-align:center;
                         border:1px solid #e2e2e2;border-radius:8px;">
                <strong style="font-size:14px;color:#111111;display:block;">
                  Line of Credit
                </strong>
                <span style="font-size:12px;color:#717171;">
                  Flexible draw and repay
                </span>
              </td>
              <td style="width:8px;"></td>
              <td style="padding:12px;text-align:center;
                         border:1px solid #e2e2e2;border-radius:8px;">
                <strong style="font-size:14px;color:#111111;display:block;">
                  Working Capital
                </strong>
                <span style="font-size:12px;color:#717171;">
                  Fast cash flow solution
                </span>
              </td>
            </tr>
          </table>
          ${greenButton(
            'Apply for Business Funding &rarr;',
            `https://lendmatecapital.com?utm_source=email&utm_medium=nurture&utm_campaign=business-loans${leadInfo.city ? '-' + leadInfo.city : ''}-welcome&utm_content=email-cta`
          )}
          ${trustNote}
        </div>
        ${footer}
      </div>
    `
  }

  // CREDIT CARDS TEMPLATE (default for all CC pages)
  return `
    <div style="${baseStyle}">
      ${header}
      <div style="background:#f0faf5;padding:32px 24px;text-align:center;">
        <h1 style="font-family:Georgia,serif;font-size:24px;
                   color:#111111;margin:0 0 8px;">
          Your Credit Card Guide Is Here, ${firstName}
        </h1>
        <p style="font-size:15px;color:#444444;margin:0;">
          How to Choose the Right Card for Your Spending
        </p>
      </div>
      <div style="padding:32px 24px;">
        ${greenButton(
          'Download Your Free Guide &rarr;',
          'https://mymoneymarketplace.github.io/guides/credit-cards-guide.pdf'
        )}
        <hr style="border:none;border-top:1px solid #e2e2e2;margin:24px 0;">
        <h2 style="font-family:Georgia,serif;font-size:20px;
                   color:#111111;margin:0 0 12px;">
          Compare 200+ Cards Now
        </h2>
        <p style="font-size:15px;color:#444444;line-height:1.6;margin:0 0 16px;">
          Find the best card for your specific spending habits
          and credit profile.
        </p>
        ${greenButton(
          'Compare Cards Now &rarr;',
          'https://lendmatecapital.com/compare-credit-cards?utm_source=email&utm_medium=nurture&utm_campaign=credit-cards-welcome&utm_content=email-cta'
        )}
      </div>
      ${footer}
    </div>
  `
}
