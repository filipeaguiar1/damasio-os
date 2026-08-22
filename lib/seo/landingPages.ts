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
    details: [
      "A good lawn service should be predictable. We start with the property itself: lawn size, access, gates, obstacles and any areas that need extra attention. From there, the service can be set up as weekly, biweekly or one-time work depending on the season and what the lawn actually needs.",
      "For recurring customers, we keep the property notes with the address so the crew is not starting from zero on every visit. Trimming, edging and the final cleanup are handled as part of the agreed scope, and any special instructions can stay attached to the property for future visits. The goal is simple: consistent work, a practical schedule and fewer surprises for the homeowner.",
    ],
  },
  "seasonal-cleanups": {
    slug: "seasonal-cleanups",
    name: "Seasonal Cleanups",
    title: "Spring & Fall Cleanup | Hamilton, Burlington, Oakville",
    description: "Spring and fall property cleanups in Hamilton, Burlington and Oakville, Ontario. Request a seasonal cleanup quote from 4Ever Seasons.",
    intro: "Spring and fall cleanup work quoted around the actual property, debris volume and service scope.",
    scope: ["Spring debris cleanup", "Fall leaf cleanup", "Bed and border cleanup", "Garden cutback", "Disposal options when required"],
    details: [
      "Seasonal cleanup work can vary a lot from one property to the next. A small spring tidy-up is very different from a fall property with heavy leaf cover, garden cutback and material that needs to be removed. We look at the property and the expected volume first so the quote reflects the work instead of relying on a generic package.",
      "Spring visits usually focus on clearing winter debris, opening up beds and getting the property ready for regular maintenance. Fall work is more about leaves, spent plant material and preparing the property for colder weather. If disposal is needed, that can be included in the scope before the visit. Clear expectations up front make the job easier to schedule and avoid last-minute changes once the crew is already on site.",
    ],
  },
  "snow-removal": {
    slug: "snow-removal",
    name: "Snow Removal",
    title: "Snow Removal | Hamilton, Burlington & Oakville",
    description: "Residential snow removal and winter property service in Hamilton, Burlington and Oakville, Ontario. Request winter service availability from 4Ever Seasons.",
    intro: "Winter service organized by route, property access and the agreed snow-removal scope.",
    scope: ["Driveway clearing", "Walkway clearing", "Property access notes", "Salting options when included", "Seasonal route planning"],
    details: [
      "Snow service works best when the property details are settled before the first storm. We confirm what needs to be cleared, where snow can be placed, whether there are narrow walkways or access issues, and whether salting is part of the service. Those details matter because two driveways on the same street can require very different amounts of work.",
      "Winter routes are planned around geography and realistic capacity rather than treating every stop like an isolated appointment. During heavier weather, route timing can shift as conditions change, so having clear property notes helps the crew move through the route without guessing at each address. Availability is confirmed before service starts, and the final scope is based on the property and the type of winter coverage requested.",
    ],
  },
  "garden-care": {
    slug: "garden-care",
    name: "Garden Care",
    title: "Garden Care | Hamilton, Burlington & Oakville",
    description: "Garden and bed maintenance in Hamilton, Burlington and Oakville, Ontario, including seasonal tidy-ups, mulch support and property-specific care.",
    intro: "Garden and bed care built around the property rather than a generic maintenance package.",
    scope: ["Bed cleanup", "Seasonal tidy-ups", "Mulch support", "Planting support", "Property-specific garden requests"],
    details: [
      "Garden beds rarely need exactly the same work from one property to another. Some need a straightforward cleanup and fresh edges, while others need seasonal cutback, mulch work or help keeping planting areas under control. We review the beds and the requested work first so the quote matches the condition of the property.",
      "For ongoing customers, notes can stay attached to the address so recurring preferences are not lost between visits. That is especially useful for beds with specific plants, areas the homeowner wants left alone or work that changes through the season. We keep the service practical and property-specific rather than turning every garden into the same checklist.",
    ],
  },
};

export const citySlugs = Object.keys(cityLandings);
export const serviceSlugs = Object.keys(serviceLandings);
