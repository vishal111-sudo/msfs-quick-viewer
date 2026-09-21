'use strict';

// StreamedPackages hold their contents in encrypted .fsarchive blobs, so the
// folder name is the only readable metadata. This catalog maps the stock
// MSFS 2020/2024 package slugs onto real aircraft identities, which gives the
// UI a proper name and category and gives the art fetcher a query good enough
// to find the right photo.
//
// Shape: slug -> { name, manufacturer, category, engineType?, wiki? }
//   name         display name
//   manufacturer used for grouping and as part of the art query
//   category     one of parsers/taxonomy CATEGORIES
//   wiki         Wikipedia article title, when it differs from `manufacturer name`
//
// Slugs not listed here fall back to a prettified folder name; that is a
// degraded but working path, not a bug. Add entries as new stock aircraft ship.

const CATALOG = {
  // --- Airbus ---
  'a310-300': { name: 'A310-300', manufacturer: 'Airbus', category: 'Airliner', wiki: 'Airbus A310' },
  a320neo: { name: 'A320neo', manufacturer: 'Airbus', category: 'Airliner', wiki: 'Airbus A320neo family' },
  a321: { name: 'A321', manufacturer: 'Airbus', category: 'Airliner', wiki: 'Airbus A321' },
  a330: { name: 'A330', manufacturer: 'Airbus', category: 'Airliner', wiki: 'Airbus A330' },
  a380: { name: 'A380', manufacturer: 'Airbus', category: 'Airliner', wiki: 'Airbus A380' },
  a400m: { name: 'A400M Atlas', manufacturer: 'Airbus', category: 'Military', wiki: 'Airbus A400M Atlas' },
  belugaxl: { name: 'BelugaXL', manufacturer: 'Airbus', category: 'Cargo', wiki: 'Airbus BelugaXL' },
  ah225: { name: 'H225 Super Puma', manufacturer: 'Airbus Helicopters', category: 'Helicopter', wiki: 'Eurocopter EC225 Super Puma' },
  h125: { name: 'H125', manufacturer: 'Airbus Helicopters', category: 'Helicopter', wiki: 'Eurocopter AS350 Écureuil' },
  ec135: { name: 'H135', manufacturer: 'Airbus Helicopters', category: 'Helicopter', wiki: 'Eurocopter EC135' },

  // --- Boeing / Douglas ---
  'b707-320c': { name: '707-320C', manufacturer: 'Boeing', category: 'Airliner', wiki: 'Boeing 707' },
  b737max: { name: '737 MAX', manufacturer: 'Boeing', category: 'Airliner', wiki: 'Boeing 737 MAX' },
  b7478i: { name: '747-8i', manufacturer: 'Boeing', category: 'Airliner', wiki: 'Boeing 747-8' },
  'b747-lcf-dreamlifter': { name: '747 LCF Dreamlifter', manufacturer: 'Boeing', category: 'Cargo', wiki: 'Boeing 747 Dreamlifter' },
  'b747-supertanker': { name: '747 SuperTanker', manufacturer: 'Boeing', category: 'Cargo', wiki: 'Global SuperTanker' },
  'b787-10': { name: '787-10 Dreamliner', manufacturer: 'Boeing', category: 'Airliner', wiki: 'Boeing 787 Dreamliner' },
  c17: { name: 'C-17 Globemaster III', manufacturer: 'Boeing', category: 'Military', wiki: 'Boeing C-17 Globemaster III' },
  ch47d: { name: 'CH-47D Chinook', manufacturer: 'Boeing', category: 'Helicopter', wiki: 'Boeing CH-47 Chinook' },
  stratoliner: { name: '307 Stratoliner', manufacturer: 'Boeing', category: 'Vintage', wiki: 'Boeing 307 Stratoliner' },
  dc3: { name: 'DC-3', manufacturer: 'Douglas', category: 'Vintage', wiki: 'Douglas DC-3' },
  c47: { name: 'C-47 Skytrain', manufacturer: 'Douglas', category: 'Vintage', wiki: 'Douglas C-47 Skytrain' },

  // --- Cessna / Textron ---
  '208b-grand-caravan-ex': { name: '208B Grand Caravan EX', manufacturer: 'Cessna', category: 'Turboprop', wiki: 'Cessna 208 Caravan' },
  c152: { name: '152', manufacturer: 'Cessna', category: 'Piston', wiki: 'Cessna 152' },
  'c152-aerobat': { name: '152 Aerobat', manufacturer: 'Cessna', category: 'Piston', wiki: 'Cessna 152' },
  'c172sp-as1000': { name: '172 Skyhawk (G1000)', manufacturer: 'Cessna', category: 'Piston', wiki: 'Cessna 172' },
  'c172sp-classic': { name: '172 Skyhawk (Classic)', manufacturer: 'Cessna', category: 'Piston', wiki: 'Cessna 172' },
  'c185f-skywagon': { name: '185F Skywagon', manufacturer: 'Cessna', category: 'Piston', wiki: 'Cessna 185 Skywagon' },
  'c188-agtruck': { name: '188 AGtruck', manufacturer: 'Cessna', category: 'Piston', wiki: 'Cessna 188' },
  'c195-businessliner': { name: '195 Businessliner', manufacturer: 'Cessna', category: 'Vintage', wiki: 'Cessna 190 and 195' },
  'c207-stationair-ii': { name: '207 Stationair II', manufacturer: 'Cessna', category: 'Piston', wiki: 'Cessna 205, 206 and 207' },
  'c400-corvalis': { name: '400 Corvalis TT', manufacturer: 'Cessna', category: 'Piston', wiki: 'Columbia 400' },
  'c404-titan': { name: '404 Titan', manufacturer: 'Cessna', category: 'Piston', wiki: 'Cessna 404 Titan' },
  'c408-skycourier': { name: '408 SkyCourier', manufacturer: 'Cessna', category: 'Turboprop', wiki: 'Cessna SkyCourier' },
  cj4: { name: 'Citation CJ4', manufacturer: 'Cessna', category: 'Business Jet', wiki: 'Cessna CitationJet/M2' },
  longitude: { name: 'Citation Longitude', manufacturer: 'Cessna', category: 'Business Jet', wiki: 'Cessna Citation Longitude' },
  'longitude-enhanced': { name: 'Citation Longitude (Enhanced)', manufacturer: 'Cessna', category: 'Business Jet', wiki: 'Cessna Citation Longitude' },

  // --- Beechcraft ---
  'baron-g58': { name: 'Baron G58', manufacturer: 'Beechcraft', category: 'Piston', wiki: 'Beechcraft Baron' },
  'bonanza-g36': { name: 'Bonanza G36', manufacturer: 'Beechcraft', category: 'Piston', wiki: 'Beechcraft Bonanza' },
  'v35-bonanza': { name: 'V35 Bonanza', manufacturer: 'Beechcraft', category: 'Piston', wiki: 'Beechcraft Bonanza' },
  'c90-gtx': { name: 'King Air C90GTx', manufacturer: 'Beechcraft', category: 'Turboprop', wiki: 'Beechcraft King Air' },
  kingair350: { name: 'King Air 350i', manufacturer: 'Beechcraft', category: 'Turboprop', wiki: 'Beechcraft Super King Air' },
  'd17-staggerwing': { name: 'Model 17 Staggerwing', manufacturer: 'Beechcraft', category: 'Vintage', wiki: 'Beechcraft Model 17 Staggerwing' },
  d18s: { name: 'Model 18', manufacturer: 'Beechcraft', category: 'Vintage', wiki: 'Beechcraft Model 18' },

  // --- Diamond / Piper / Robin / Cirrus ---
  'da40-ng': { name: 'DA40 NG', manufacturer: 'Diamond Aircraft', category: 'Piston', wiki: 'Diamond DA40' },
  'da40-tdi': { name: 'DA40 TDI', manufacturer: 'Diamond Aircraft', category: 'Piston', wiki: 'Diamond DA40' },
  da62: { name: 'DA62', manufacturer: 'Diamond Aircraft', category: 'Piston', wiki: 'Diamond DA62' },
  dv20: { name: 'DV20 Katana', manufacturer: 'Diamond Aircraft', category: 'Piston', wiki: 'Diamond DV20' },
  archer: { name: 'PA-28 Archer', manufacturer: 'Piper', category: 'Piston', wiki: 'Piper PA-28 Cherokee' },
  'pa28-236-dakota': { name: 'PA-28-236 Dakota', manufacturer: 'Piper', category: 'Piston', wiki: 'Piper PA-28 Cherokee' },
  dr400: { name: 'DR400', manufacturer: 'Robin', category: 'Piston', wiki: 'Robin DR400' },
  sr22: { name: 'SR22', manufacturer: 'Cirrus', category: 'Piston', wiki: 'Cirrus SR22' },
  sf50: { name: 'SF50 Vision Jet', manufacturer: 'Cirrus', category: 'Business Jet', wiki: 'Cirrus Vision SF50' },

  // --- Pilatus / Daher / Epic / other turboprops ---
  'pc12-ngx': { name: 'PC-12 NGX', manufacturer: 'Pilatus', category: 'Turboprop', wiki: 'Pilatus PC-12' },
  pc24: { name: 'PC-24', manufacturer: 'Pilatus', category: 'Business Jet', wiki: 'Pilatus PC-24' },
  'pilatus-pc6': { name: 'PC-6 Porter', manufacturer: 'Pilatus', category: 'Turboprop', wiki: 'Pilatus PC-6 Porter' },
  'pilatus-pc6-g950-wheels': { name: 'PC-6 Porter (G950)', manufacturer: 'Pilatus', category: 'Turboprop', wiki: 'Pilatus PC-6 Porter' },
  tbm930: { name: 'TBM 930', manufacturer: 'Daher', category: 'Turboprop', wiki: 'Socata TBM' },
  'tbm930-enhanced': { name: 'TBM 930 (Enhanced)', manufacturer: 'Daher', category: 'Turboprop', wiki: 'Socata TBM' },
  at802: { name: 'AT-802', manufacturer: 'Air Tractor', category: 'Turboprop', wiki: 'Air Tractor AT-802' },
  atr: { name: 'ATR 42-600 / 72-600', manufacturer: 'ATR', category: 'Turboprop', wiki: 'ATR 72' },
  cl415: { name: 'CL-415', manufacturer: 'Canadair', category: 'Turboprop', wiki: 'Canadair CL-415' },
  'saab-340': { name: '340', manufacturer: 'Saab', category: 'Turboprop', wiki: 'Saab 340' },
  mu2: { name: 'MU-2', manufacturer: 'Mitsubishi', category: 'Turboprop', wiki: 'Mitsubishi MU-2' },
  skyvan: { name: 'SC.7 Skyvan', manufacturer: 'Short Brothers', category: 'Turboprop', wiki: 'Short SC.7 Skyvan' },

  // --- de Havilland Canada ---
  dhc2: { name: 'DHC-2 Beaver', manufacturer: 'de Havilland Canada', category: 'Piston', wiki: 'De Havilland Canada DHC-2 Beaver' },
  'dhc4-caribou': { name: 'DHC-4 Caribou', manufacturer: 'de Havilland Canada', category: 'Vintage', wiki: 'De Havilland Canada DHC-4 Caribou' },
  dhc6: { name: 'DHC-6 Twin Otter', manufacturer: 'de Havilland Canada', category: 'Turboprop', wiki: 'De Havilland Canada DHC-6 Twin Otter' },

  // --- Helicopters ---
  bell407: { name: '407', manufacturer: 'Bell', category: 'Helicopter', wiki: 'Bell 407' },
  bell47j: { name: '47J Ranger', manufacturer: 'Bell', category: 'Helicopter', wiki: 'Bell 47' },
  uh1h: { name: 'UH-1H Iroquois', manufacturer: 'Bell', category: 'Helicopter', wiki: 'Bell UH-1 Iroquois' },
  'cabri-g2': { name: 'Cabri G2', manufacturer: 'Guimbal', category: 'Helicopter', wiki: 'Guimbal Cabri G2' },
  r66: { name: 'R66 Turbine', manufacturer: 'Robinson', category: 'Helicopter', wiki: 'Robinson R66' },
  aircrane: { name: 'S-64 Air Crane', manufacturer: 'Erickson', category: 'Helicopter', wiki: 'Sikorsky S-64 Skycrane' },
  s12g: { name: 'S-12G', manufacturer: 'Rotorway', category: 'Helicopter' },

  // --- Military / warbirds ---
  a10c: { name: 'A-10C Thunderbolt II', manufacturer: 'Fairchild Republic', category: 'Military', wiki: 'Fairchild Republic A-10 Thunderbolt II' },
  fa18e: { name: 'F/A-18E Super Hornet', manufacturer: 'Boeing', category: 'Military', wiki: 'Boeing F/A-18E/F Super Hornet' },
  p51d: { name: 'P-51D Mustang', manufacturer: 'North American', category: 'Military', wiki: 'North American P-51 Mustang' },
  'p51d-reno': { name: 'P-51D Mustang (Reno)', manufacturer: 'North American', category: 'Military', wiki: 'North American P-51 Mustang' },
  't6-reno': { name: 'T-6 Texan (Reno)', manufacturer: 'North American', category: 'Military', wiki: 'North American T-6 Texan' },
  'l39-reno': { name: 'L-39 Albatros (Reno)', manufacturer: 'Aero Vodochody', category: 'Military', wiki: 'Aero L-39 Albatros' },
  norden: { name: 'Norden Bombsight Trainer', manufacturer: 'Norden', category: 'Vintage', wiki: 'Norden bombsight' },
  jn4: { name: 'JN-4 Jenny', manufacturer: 'Curtiss', category: 'Vintage', wiki: 'Curtiss JN-4' },
  c46: { name: 'C-46 Commando', manufacturer: 'Curtiss-Wright', category: 'Vintage', wiki: 'Curtiss C-46 Commando' },
  cg4a: { name: 'CG-4A Hadrian', manufacturer: 'Waco', category: 'Glider', wiki: 'Waco CG-4' },
  'grumman-albatross': { name: 'HU-16 Albatross', manufacturer: 'Grumman', category: 'Vintage', wiki: 'Grumman HU-16 Albatross' },
  'g-21': { name: 'G-21 Goose', manufacturer: 'Grumman', category: 'Vintage', wiki: 'Grumman G-21 Goose' },
  fw200: { name: 'Fw 200 Condor', manufacturer: 'Focke-Wulf', category: 'Vintage', wiki: 'Focke-Wulf Fw 200 Condor' },
  saab17: { name: 'B 17', manufacturer: 'Saab', category: 'Vintage', wiki: 'Saab 17' },
  'hughes-h4-hercules': { name: 'H-4 Hercules (Spruce Goose)', manufacturer: 'Hughes', category: 'Vintage', wiki: 'Hughes H-4 Hercules' },

  // --- Antonov / Dornier / Junkers / other classics ---
  an225: { name: 'An-225 Mriya', manufacturer: 'Antonov', category: 'Cargo', wiki: 'Antonov An-225 Mriya' },
  antonov2: { name: 'An-2', manufacturer: 'Antonov', category: 'Vintage', wiki: 'Antonov An-2' },
  aero45: { name: 'Aero 45', manufacturer: 'Aero', category: 'Vintage', wiki: 'Aero 45' },
  do31: { name: 'Do 31', manufacturer: 'Dornier', category: 'Vintage', wiki: 'Dornier Do 31' },
  'dornier-doj': { name: 'Do J Wal', manufacturer: 'Dornier', category: 'Vintage', wiki: 'Dornier Do J' },
  'dornier-doj-cabina': { name: 'Do J Wal (Cabina)', manufacturer: 'Dornier', category: 'Vintage', wiki: 'Dornier Do J' },
  'dornier-doj-n25': { name: 'Do J Wal (N25)', manufacturer: 'Dornier', category: 'Vintage', wiki: 'Dornier Do J' },
  'dornier-doj-plusultra': { name: 'Do J Wal (Plus Ultra)', manufacturer: 'Dornier', category: 'Vintage', wiki: 'Dornier Do J' },
  'dornier-dox': { name: 'Do X', manufacturer: 'Dornier', category: 'Vintage', wiki: 'Dornier Do X' },
  'junkers-f13': { name: 'F 13', manufacturer: 'Junkers', category: 'Vintage', wiki: 'Junkers F 13' },
  'junkers-f13-floats': { name: 'F 13 (Floats)', manufacturer: 'Junkers', category: 'Vintage', wiki: 'Junkers F 13' },
  'junkers-f13-modern': { name: 'F 13 (Modern)', manufacturer: 'Junkers', category: 'Vintage', wiki: 'Junkers F 13' },
  'junkers-f13-skis': { name: 'F 13 (Skis)', manufacturer: 'Junkers', category: 'Vintage', wiki: 'Junkers F 13' },
  'junkers-ju52': { name: 'Ju 52', manufacturer: 'Junkers', category: 'Vintage', wiki: 'Junkers Ju 52' },
  'junkers-ju52-floats': { name: 'Ju 52 (Floats)', manufacturer: 'Junkers', category: 'Vintage', wiki: 'Junkers Ju 52' },
  'junkers-ju52-skis': { name: 'Ju 52 (Skis)', manufacturer: 'Junkers', category: 'Vintage', wiki: 'Junkers Ju 52' },
  'junkers-ju52-wheels': { name: 'Ju 52 (Wheels)', manufacturer: 'Junkers', category: 'Vintage', wiki: 'Junkers Ju 52' },
  'fokker-vii': { name: 'F.VIIb/3m', manufacturer: 'Fokker', category: 'Vintage', wiki: 'Fokker F.VII' },
  'ford-trimotor': { name: 'Trimotor', manufacturer: 'Ford', category: 'Vintage', wiki: 'Ford Trimotor' },
  'latecoere-631': { name: 'Latécoère 631', manufacturer: 'Latécoère', category: 'Vintage', wiki: 'Latécoère 631' },
  'savoia-s55': { name: 'S.55', manufacturer: 'Savoia-Marchetti', category: 'Vintage', wiki: 'Savoia-Marchetti S.55' },
  'savoia-s55x': { name: 'S.55X', manufacturer: 'Savoia-Marchetti', category: 'Vintage', wiki: 'Savoia-Marchetti S.55' },
  'spirit-of-st-louis': { name: 'Spirit of St. Louis', manufacturer: 'Ryan', category: 'Vintage', wiki: 'Spirit of St. Louis' },
  'wright-flyer': { name: 'Wright Flyer', manufacturer: 'Wright Brothers', category: 'Vintage', wiki: 'Wright Flyer' },
  'geebee-r2': { name: 'Gee Bee R-2', manufacturer: 'Granville Brothers', category: 'Vintage', wiki: 'Gee Bee Model R' },
  'geebee-z': { name: 'Gee Bee Model Z', manufacturer: 'Granville Brothers', category: 'Vintage', wiki: 'Gee Bee Model Z' },
  skyship600: { name: 'Skyship 600', manufacturer: 'Airship Industries', category: 'Other', wiki: 'Skyship 600' },

  // --- Aerobatic / sport / light sport ---
  pitts: { name: 'Pitts Special S1/S2', manufacturer: 'Pitts', category: 'Piston', wiki: 'Pitts Special' },
  'pitts-s1-reno': { name: 'Pitts Special S1 (Reno)', manufacturer: 'Pitts', category: 'Piston', wiki: 'Pitts Special' },
  'pitts-s2': { name: 'Pitts Special S2', manufacturer: 'Pitts', category: 'Piston', wiki: 'Pitts Special' },
  'pitts-s2-rufus': { name: 'Pitts Special S2 (Rufus)', manufacturer: 'Pitts', category: 'Piston', wiki: 'Pitts Special' },
  'pitts-s2-sam': { name: 'Pitts Special S2 (Sam)', manufacturer: 'Pitts', category: 'Piston', wiki: 'Pitts Special' },
  edge540: { name: 'Edge 540', manufacturer: 'Zivko', category: 'Piston', wiki: 'Zivko Edge 540' },
  edge540v2: { name: 'Edge 540 V2', manufacturer: 'Zivko', category: 'Piston', wiki: 'Zivko Edge 540' },
  cap10c: { name: 'CAP 10C', manufacturer: 'Mudry', category: 'Piston', wiki: 'Mudry CAP 10' },
  mxs: { name: 'MXS-R', manufacturer: 'MX Aircraft', category: 'Piston', wiki: 'MX Aircraft MXS' },
  xcub: { name: 'XCub', manufacturer: 'CubCrafters', category: 'Piston', wiki: 'CubCrafters XCub' },
  nxcub: { name: 'NXCub', manufacturer: 'CubCrafters', category: 'Piston', wiki: 'CubCrafters XCub' },
  'savage-cub': { name: 'Savage Cub', manufacturer: 'Zlin Aviation', category: 'Piston', wiki: 'Zlin Savage' },
  'savage-shockultra': { name: 'Savage Shock Ultra', manufacturer: 'Zlin Aviation', category: 'Piston', wiki: 'Zlin Savage' },
  flightdesignct: { name: 'CT Supralight', manufacturer: 'Flight Design', category: 'Ultralight', wiki: 'Flight Design CT' },
  icon: { name: 'A5', manufacturer: 'ICON Aircraft', category: 'Piston', wiki: 'Icon A5' },
  seastar: { name: 'Seastar', manufacturer: 'Dornier', category: 'Turboprop', wiki: 'Dornier Seastar' },
  pipistrel: { name: 'Virus SW 121', manufacturer: 'Pipistrel', category: 'Ultralight', wiki: 'Pipistrel Virus' },
  vl3: { name: 'VL3', manufacturer: 'JMB Aircraft', category: 'Ultralight', wiki: 'JMB VL-3 Evolution' },
  'magni-m24': { name: 'M24 Orion', manufacturer: 'Magni Gyro', category: 'Ultralight', wiki: 'Magni M24 Orion' },
  'cgs-hawk-arrow-ii': { name: 'Hawk Arrow II', manufacturer: 'CGS Aviation', category: 'Ultralight', wiki: 'CGS Hawk' },
  wasp: { name: 'Wasp', manufacturer: 'Rotor X', category: 'Ultralight' },
  // A powered parachute; Wikipedia has the type but not this model.
  skyrascal: { name: 'Sky Rascal', manufacturer: 'Powrachute', category: 'Ultralight', wiki: 'Powered parachute' },
  hotairballoon: { name: 'Hot Air Balloon', manufacturer: 'Asobo', category: 'Other', wiki: 'Hot air balloon' },
  blimp: { name: 'Blimp', manufacturer: 'Asobo', category: 'Other', wiki: 'Blimp' },

  // --- Gliders ---
  ls8: { name: 'LS8-18', manufacturer: 'DG Flugzeugbau', category: 'Glider', wiki: 'Rolladen-Schneider LS8' },
  'dg1001-e': { name: 'DG-1001E Neo', manufacturer: 'DG Flugzeugbau', category: 'Glider', wiki: 'DG Flugzeugbau DG-1000' },
  'taurus-m': { name: 'Taurus M', manufacturer: 'Pipistrel', category: 'Glider', wiki: 'Pipistrel Taurus' },

  // --- Electric / experimental / eVTOL ---
  es30: { name: 'ES-30', manufacturer: 'Heart Aerospace', category: 'Airliner', wiki: 'Heart Aerospace ES-30' },
  // The stock aerobatic Extra; Wikipedia covers the 330 under the EA-300 family.
  e330: { name: '330LT', manufacturer: 'Extra Flugzeugbau', category: 'Piston', wiki: 'Extra EA-300' },
  volocity: { name: 'VoloCity', manufacturer: 'Volocopter', category: 'Other', wiki: 'Volocopter VoloCity' },
  joby: { name: 'S4', manufacturer: 'Joby Aviation', category: 'Other', wiki: 'Joby Aviation' },
  'jetson-one': { name: 'Jetson ONE', manufacturer: 'Jetson', category: 'Ultralight', wiki: 'Jetson ONE' },
  'boom-xb1': { name: 'XB-1', manufacturer: 'Boom Supersonic', category: 'Other', wiki: 'Boom XB-1' },
  optica: { name: 'Optica', manufacturer: 'Edgley', category: 'Piston', wiki: 'Edgley Optica' },
  // Mike Patey's turbine STOL build; no article of its own, so fall back to
  // the PZL Wilga airframe it is built from.
  dracox: { name: 'Draco X', manufacturer: 'Mike Patey', category: 'Turboprop', wiki: 'PZL-104 Wilga' },
  // A real steerable balloon (flydoo.fun) with no article of its own.
  flydoo: { name: 'Hot Air Balloon', manufacturer: 'FlyDOO', category: 'Other', wiki: 'Hot air balloon' },
  cap4: {
    name: 'CAP-4 Paulistinha',
    manufacturer: 'Companhia Aeronáutica Paulista',
    category: 'Vintage',
    wiki: 'CAP-4 Paulistinha',
  },
};

/** Slugs that are shared asset packages, not selectable aircraft. */
const SHARED_ASSET_SUFFIXES = ['-common', '-shared', '-base'];

/** Turn `b747-lcf-dreamlifter` into `B747 Lcf Dreamlifter` as a last resort. */
function prettifySlug(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => (/\d/.test(word) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

function lookup(slug) {
  return CATALOG[slug] || null;
}

function isSharedAsset(slug) {
  return SHARED_ASSET_SUFFIXES.some((suffix) => slug.endsWith(suffix));
}

module.exports = { CATALOG, lookup, prettifySlug, isSharedAsset };
