import Script from "next/script";

/**
 * Lightweight, env-gated analytics scaffolding. Set these in your Cloudflare
 * Worker secrets / wrangler.toml [vars] to activate:
 *
 *   NEXT_PUBLIC_GA_ID       e.g. G-XXXXXXX     (Google Analytics 4)
 *   NEXT_PUBLIC_META_PIXEL  e.g. 1234567890    (Meta / Facebook pixel)
 *
 * If a value is unset, no script is emitted. Standard events fire on
 * page-view automatically. Custom commerce events (purchase, add_to_cart)
 * can be dispatched from server actions or client components later.
 */
export function AnalyticsScripts() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const fbId = process.env.NEXT_PUBLIC_META_PIXEL;
  if (!gaId && !fbId) return null;

  return (
    <>
      {gaId ? (
        <>
          <Script
            id="ga4-loader"
            strategy="afterInteractive"
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${gaId}', { send_page_view: true });
            `}
          </Script>
        </>
      ) : null}

      {fbId ? (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
              n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
              document,'script','https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${fbId}');
            fbq('track', 'PageView');
          `}
        </Script>
      ) : null}
    </>
  );
}
