const request = require('supertest');
const app = require('../src/app');
const { countries } = require('../src/data/countries.json');
const { getAllCountries, getCurrencyForCountry } = require('../src/utils/currencies');

test('country API covers the complete bundled catalog with current currency defaults', async () => {
  const response = await request(app).get('/api/businesses/countries');
  expect(response.status).toBe(200);
  const rows = response.body.data;
  expect(rows).toHaveLength(245);
  expect(new Set(countries.map(row => row.iso)).size).toBe(245);
  expect(new Set(getAllCountries()).size).toBe(245);
  const code = name => rows.find(row => row.country === name)?.currency.code;
  expect(code('India')).toBe('INR');
  expect(code('Nepal')).toBe('NPR');
  expect(code('Sri Lanka')).toBe('LKR');
  expect(code('Bulgaria')).toBe('EUR');
  expect(code('Zimbabwe')).toBe('ZWG');
  expect(code('Curaçao')).toBe('XCG');
  rows.forEach(row => {
    expect(row.currency.code).toMatch(/^[A-Z]{3}$/);
    expect(row.currency.name).toBeTruthy();
    expect(row.currency.symbol).toBeTruthy();
  });
});

test('currency lookup preserves stored names and accepts common aliases and codes', () => {
  expect(getCurrencyForCountry('UAE').code).toBe('AED');
  expect(getCurrencyForCountry('United Arab Emirates').code).toBe('AED');
  expect(getCurrencyForCountry('Ivory Coast').code).toBe('XOF');
  expect(getCurrencyForCountry("Côte d'Ivoire").code).toBe('XOF');
  expect(getCurrencyForCountry('in').code).toBe('INR');
  expect(getCurrencyForCountry('Unknown')).toEqual({ code: 'USD', name: 'US Dollar', symbol: '$' });
});
