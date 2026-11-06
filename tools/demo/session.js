export const cart = 'https://shop.example/cart';
export const checkout = 'https://shop.example/checkout';
export const navigateAt = 9800;

const ga = (en, dl, extra) => `https://region1.google-analytics.com/g/collect?v=2&tid=G-DEMO123&gtm=45je5b10&cid=1789.4512&en=${en}&dl=${encodeURIComponent(dl)}&${extra}`;

export function demoSession(t0) {
  const net = [
    [900, cart, ga('page_view', cart, 'gcs=G100&dt=Cart')],
    [1400, cart, 'https://www.facebook.com/tr/?id=1234567890123456&ev=PageView&dl=' + encodeURIComponent(cart)],
    [3300, cart, ga('select_promotion', cart, 'gcs=G100&ep.promotion_id=SPRING10&ep.creative_name=banner')],
    [10400, checkout, ga('begin_checkout', checkout, 'gcs=G111&cu=USD&epn.value=129')],
    [10500, checkout, 'https://www.facebook.com/tr/?id=1234567890123456&ev=InitiateCheckout&cd[value]=129&cd[currency]=USD&eid=evt-41'],
    [14400, checkout, ga('purchase', checkout, 'gcs=G111&cu=USD&epn.value=129&ep.transaction_id=A-1042')],
    [14500, checkout, ga('purchase', checkout, 'gcs=G111&cu=USD&epn.value=129&ep.transaction_id=A-1042')],
    [14600, checkout, 'https://www.googleadservices.com/pagead/conversion/987654321/?label=AbC-D&oid=A-1042&value=129&currency_code=USD'],
  ];
  const layer = [
    [0, cart, ['consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied' }]],
    [100, cart, { event: 'gtm.js', 'gtm.start': t0 }],
    [3200, cart, { event: 'add_promo', promo_code: 'SPRING10' }],
    [9800, checkout, { event: 'gtm.historyChange', page: '/checkout' }],
    [10100, checkout, ['consent', 'update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted' }]],
    [13900, checkout, { event: 'purchase', ecommerce: { transaction_id: 'A-1042', value: 129, currency: 'USD' }, user: { email: 'jane.doe@example.com' } }],
  ];
  return [
    ...net.map(([dt, page, url]) => ({ dt, page, url })),
    ...layer.map(([dt, page, msg]) => ({ dt, page, msg })),
  ].sort((a, b) => a.dt - b.dt);
}
