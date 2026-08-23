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
  details: string[];
};

export const cityLandings: Record<string, CityLanding> = {
  hamilton: {
    slug: "hamilton",
    name: "Hamilton",
    title: "Property Maintenance in Hamilton, ON | 4Ever Seasons",
    description: "Lawn care, seasonal cleanups, garden maintenance and winter property service in Hamilton, Ontario. Request a property quote from 4Ever Seasons.",
    intro: "Lawn care, cleanups, garden work and winter service for Hamilton homes, with the scope and schedule confirmed before work begins.",
    localCopy: "Hamilton has everything from compact city lots to larger suburban properties, so the same service can mean very different amounts of work. We review the address, access and requested scope before confirming the quote and route.",
  },
  burlington: {
    slug: "burlington",
    name: "Burlington",
    title: "Property Maintenance in Burlington, ON | 4Ever Seasons",
    description: "Lawn care, seasonal cleanups, garden maintenance and winter property service in Burlington, Ontario. Request a property quote from 4Ever Seasons.",
    intro: "Recurring and seasonal property care for Burlington homes, organized around local routes and the needs of each address.",
    localCopy: "For Burlington customers, we group recurring work by area and keep the property instructions with the address. That makes scheduling more reliable and gives the crew the details they need before they arrive.",
  },
  oakville: {
    slug: "oakville",
    name: "Oakville",
    title: "Property Maintenance in Oakville, ON | 4Ever Seasons",
    description: "Lawn care, seasonal cleanups, garden maintenance and winter property service in Oakville, Ontario. Request a property quote from 4Ever Seasons.",
    intro: "Four-season property care for Oakville homes, from regular lawn visits to cleanups, garden work and winter service.",
    localCopy: "Many Oakville properties need a mix of routine maintenance and seasonal work. We keep recurring instructions and service history attached to the property so each visit starts with the right context.",
  },
};

export const serviceLandings: Record<string, ServiceLanding> = {
  "lawn-care": {
    slug: "lawn-care",
    name: "Lawn Care",
    title: "Lawn Care in Hamilton, Burlington & Oakville | 4Ever Seasons",
    description: "Weekly, biweekly and one-time lawn care in Hamilton, Burlington and Oakville, Ontario. Request a lawn care quote from 4Ever Seasons.",
    intro: "Weekly, biweekly and one-time lawn care with the property details and recurring instructions kept with the address.",
    scope: ["Weekly lawn cutting", "Biweekly lawn cutting", "One-time lawn cuts", "Trimming and edging", "Cleanup pass after service"],
    details: [
      "We start with the basics that actually affect the job: lawn size, access, gates, obstacles and any areas that need special attention. From there, we can set the property up for weekly, biweekly or one-time service based on the season and the condition of the lawn.",
      "For recurring customers, the crew can see the property notes instead of relying on memory or old messages. Trimming, edging and the final tidy-up follow the approved scope, while ongoing preferences remain attached to the address for future visits.",
    ],
  },
  "seasonal-cleanups": {
    slug: "seasonal-cleanups",
    name: "Seasonal Cleanups",
    title: "Spring & Fall Cleanup | Hamilton, Burlington, Oakville",
    description: "Spring and fall property cleanups in Hamilton, Burlington and Oakville, Ontario. Request a seasonal cleanup quote from 4Ever Seasons.",
    intro: "Spring and fall cleanups priced around the size of the property, the amount of material and what needs to be removed or left on site.",
    scope: ["Spring debris cleanup", "Fall leaf cleanup", "Bed and border cleanup", "Garden cutback", "Disposal options when required"],
    details: [
      "A light spring tidy-up and a heavy fall leaf cleanup are not the same job. We look at the property size, leaf and debris volume, garden work and disposal needs so the quote reflects the work that is actually there.",
      "Spring visits usually focus on winter debris, beds and getting the property ready for regular maintenance. Fall work is more about leaves, spent plant material and preparing the property for colder weather. Disposal can be included when needed and is confirmed before the visit.",
    ],
  },
  "snow-removal": {
    slug: "snow-removal",
    name: "Snow Removal",
    title: "Snow Removal | Hamilton, Burlington & Oakville",
    description: "Residential snow removal and winter property service in Hamilton, Burlington and Oakville, Ontario. Request winter service availability from 4Ever Seasons.",
    intro: "Residential snow service planned by route, driveway size, clearing area and the access details for each property.",
    scope: ["Driveway clearing", "Walkway clearing", "Property access notes", "Salting options when included", "Seasonal route planning"],
    details: [
      "Before winter service starts, we confirm what needs to be cleared, where snow can be placed, whether walkways or steps are included and whether salting is part of the scope. Those details make a big difference to both timing and price.",
      "Snow routes are organized geographically so crews can move through an area efficiently during a storm. Timing can shift with snowfall and road conditions, but having the property instructions in place helps each stop run more smoothly.",
    ],
  },
  "garden-care": {
    slug: "garden-care",
    name: "Garden Care",
    title: "Garden Care | Hamilton, Burlington & Oakville",
    description: "Garden and bed maintenance in Hamilton, Burlington and Oakville, Ontario, including seasonal tidy-ups, mulch support and property-specific care.",
    intro: "Garden and bed maintenance based on the condition of the property and the work you actually want completed.",
    scope: ["Bed cleanup", "Seasonal tidy-ups", "Mulch support", "Planting support", "Property-specific garden requests"],
    details: [
      "Some beds only need cleanup and fresh edges; others need seasonal cutback, mulch work or more involved upkeep. We review the condition of the beds and the requested work before confirming the scope.",
      "For ongoing customers, notes about plants, areas to leave alone and seasonal preferences can stay with the property. That gives the crew useful context from one visit to the next without turning every garden into the same checklist.",
    ],
  },
};

export const citySlugs = Object.keys(cityLandings);
export const serviceSlugs = Object.keys(serviceLandings);
