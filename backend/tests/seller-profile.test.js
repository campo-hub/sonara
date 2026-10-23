import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPublicSellerProfile,
  getUserRoles,
  saveSellerProfile,
  updateSellerAdminState
} from '../src/userStore.js';

test('seller onboarding grants seller role and only admin can set verification', async () => {
  const profile = await saveSellerProfile({
    uid: 'seller-onboarding-test',
    email: 'farmer@example.test',
    displayName: 'Green Acres',
    bio: 'Seasonal vegetables.',
    county: 'Kiambu',
    town: 'Thika'
  });
  assert.deepEqual(profile.roles, ['buyer', 'seller']);
  assert.equal(profile.sellerProfile.verified, false);
  assert.deepEqual(await getUserRoles(profile.uid), ['buyer', 'seller']);

  const verified = await updateSellerAdminState(profile.uid, { 'sellerProfile.verified': true });
  assert.equal(verified.sellerProfile.verified, true);
  assert.equal((await getPublicSellerProfile(profile.uid)).verified, true);

  await updateSellerAdminState(profile.uid, { 'sellerProfile.suspended': true });
  assert.deepEqual(await getUserRoles(profile.uid), ['buyer']);
  assert.equal(await getPublicSellerProfile(profile.uid), null);
  await assert.rejects(saveSellerProfile({
    uid: profile.uid,
    email: profile.email,
    displayName: 'Green Acres',
    bio: '',
    county: 'Kiambu',
    town: 'Thika'
  }), (error) => error.code === 'SELLER_SUSPENDED');
});
