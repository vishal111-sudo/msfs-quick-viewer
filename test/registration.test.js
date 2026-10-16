'use strict';

// Tail numbers shown on livery tiles. Model and military designations look a
// lot like registrations, and a wrong tail number on screen is worse than
// none, so the negatives matter as much as the positives.

const test = require('node:test');
const assert = require('node:assert/strict');

const { findRegistration, pickRegistration } = require('../src/main/parsers/registration');

test('finds registrations in livery folder and display names', () => {
  const cases = {
    'Delta N324DU': 'N324DU',
    'A2A N6229P': 'N6229P',
    'PMDG 737-800 WestJet C-FPLS': 'C-FPLS',
    'A330-200 (GE) TAP Air Portugal CS-TON': 'CS-TON',
    'Allegiant Air Modern N323NV (2024)': 'N323NV',
    'Avianca (HC-CSA)': 'HC-CSA',
    'A7-AHA': 'A7-AHA',
    'HB-PMB': 'HB-PMB',
    'Air France F-HUVC': 'F-HUVC',
  };
  for (const [name, expected] of Object.entries(cases)) assert.equal(findRegistration(name), expected, name);
});

test('never mistakes a model or military designation for a registration', () => {
  for (const name of [
    'Airbus A220-300',
    'Boeing 777-300ER',
    'PA-28R-201T',
    'F-16',
    'F-35A',
    'F/A-18E',
    'MD-11',
    'KC-135R',
    'CH-47D Chinook',
    'AH-64D',
    'C-172',
    'DC-3',
    'L-39 Albatros',
    'A_BCS3_SYN_HOUSE',
    'N1 limiter',
  ]) {
    assert.equal(findRegistration(name), undefined, name);
  }
});

test('the most specific source wins', () => {
  // The folder says N324DU; the display name says nothing useful.
  assert.equal(findRegistration('Delta N324DU', 'Delta A220-300'), 'N324DU');
});

test('a declared atc_id is checked, not trusted', () => {
  // A fragment loses to the full registration in the livery's name.
  assert.equal(pickRegistration('SAB', ['ZK-SAB']), 'ZK-SAB');
  // The type designator, a callsign, a placeholder: none are tail numbers.
  assert.equal(pickRegistration('B38M', ['737-MAX8 (166Seats)'], 'B38M'), undefined);
  assert.equal(pickRegistration('IRONCAT', ['VF-27 No.5']), undefined);
  assert.equal(pickRegistration('Custom', ['Custom']), undefined);
  // Military serials on warbirds are real airframe identifiers.
  assert.equal(pickRegistration('BF273', ['Royal Air Force']), 'BF273');
  assert.equal(pickRegistration('A58-602', ["RAAF - 457 Sqn 'Grey Nurse'"]), 'A58-602');
  // A genuine declared registration still counts when the name has none.
  assert.equal(pickRegistration('VH-LLA', ['Custom']), 'VH-LLA');
});
