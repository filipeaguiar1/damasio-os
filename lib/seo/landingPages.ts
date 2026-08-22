export type CityLanding = {
  slug: string;
  name: string;
  title: string;
  description: string;
  intro: string;
  localCopy: string;
};

export type ServiceLanding = {
  slug: string;
  name: string;
  title: string;
  description: string;
  intro: string;
  scope: string[];
};

export const cityLandings: Record<string, CityLanding> = {
  hamilton: {
    slug: "hamilton",
    name: "Hamilton",
    title: "Property Maintenance in Hamilton, ON | 4Ever Seasons",
    description: "Lawn care, seasonal cleanups, garden maintenance and winter property service in Hamilton, Ontario. Request a property quote from 4Ever Seasons.",
    intro: "Property maintenance in Hamilton with clear scheduling, service notes and a practical seasonal plan for the address.",
    localCopy: "Hamilton properties can vary widely in lot size, access and seasonal needs. We review the property details first so lawn care, cleanup work, garden maintenance or winter service can be quoted and scheduled realistically.",
  },
  burlington: {
    slug: "burlington",
    name: "Burlington",
    title: "Property Maintenance in Burlington, ON | 4Ever Seasons",
    description: "Lawn care, seasonal cleanups, garden maintenance and winter property service in Burlington, Ontario. Request a property quote from 4Ever Seasons.",
    intro: "Reliable property maintenance in Burlington with route-based scheduling and a clear scope before the visit starts.",
    localCopy: "For Burlington properties, we organize recurring and seasonal work around the address, access details and the service requested. That keeps quotes clearer and helps recurring visits fit the route instead of being treated as isolated appointments.",
  },
  oakville: {
    slug: "oakville",
    name: "Oakville",
    title: "Property Maintenance in Oakville, ON | 4Ever Seasons",
    description: "Lawn care, seasonal cleanups, garden maintenance and winter property service in Oakville, Ontario. Request a property quote from 4Ever Seasons.",
    intro: "Four-season property maintenance in Oakville with property-specific notes, realistic scheduling and clear service history.",
    localCopy: "Oakville properties often need a mix of routine lawn work and seasonal attention. We keep the service plan attached to the property so recurring visits, cleanups and special instructions stay organized throughout the year.",
  },
};

export const serviceLandings: Record<string, ServiceLanding> = {
  "lawn-care": {
    slug: "lawn-care",
    name: "Lawn Care",
    title: "Lawn Care in Hamilton, Burlington & Oakville | 4Ever Seasons",
    description: "Weekly, biweekly and one-time lawn care in Hamilton, Burlington and Oakville, Ontario. Request a lawn care quote from 4Ever Seasons.",
    intro: "Lawn care planned around the property and the route, with clear service scope and visit records.",
    scope: ["Weekly lawn cutting", "Biweekly lawn cutting", "One-time lawn cuts", "Trimming and edging", "Cleanup pass after service"],
  },
  "seasonal-cleanups": {
    slug: "seasonal-cleanups",
    name: "Seasonal Cleanups",
    title: "Spring & Fall Cleanups in Hamilton, Burlington & Oakville | 4Ever Seasons",
    description: "Spring and fall property cleanups in Hamilton, Burlington and Oakville, Ontario. Request a seasonal cleanup quote from 4Ever Seasons.",
    intro: "Spring and fall cleanup work quoted around the actual property, debris volume and service scope.",
    scope: ["Spring debris cleanup", "Fall leaf cleanup", "Bed and border cleanup", "Garden cutback", "Disposal options when required"],
  },
  "snow-removal": {
    slug: "snow-removal",
    name: "Snow Removal",
    title: "Snow Removal in Hamilton, Burlington & Oakville | 4Ever Seasons",
    description: "Residential snow removal and winter property service in Hamilton, Burlington and Oakville, Ontario. Request winter service availability from 4Ever Seasons.",
    intro: "Winter service organized by route, property access and the agreed snow-removal scope.",
    scope: ["Driveway clearing", "Walkway clearing", "Property access notes", "Salting options when included", "Seasonal route planning"],
  },
  "garden-care": {
    slug: "garden-care",
    name: "Garden Care",
    title: "Garden & Bed Care in Hamilton, Burlington & Oakville | 4Ever Seasons",
    description: "Garden and bed maintenance in Hamilton, Burlington and Oakville, Ontario, including seasonal tidy-ups, mulch support and property-specific care.",
    intro: "Garden and bed care built around the property rather than a generic maintenance package.",
    scope: ["Bed cleanup", "Seasonal tidy-ups", "Mulch support", "Planting support", "Property-specific garden requests"],
  },
};

export const citySlugs = Object.keys(cityLandings);
export const serviceSlugs = Object.keys(serviceLandings);
