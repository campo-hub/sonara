export async function notify({ to, template, data }) {
  console.info(JSON.stringify({
    type: 'marketplace_notification',
    to,
    template,
    data
  }));
}
