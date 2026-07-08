import type { EstimateItem } from "./storage";

export const estimateTemplates: { name: string; title: string; description: string; items: EstimateItem[] }[] = [
  {
    name: "Mulch Install",
    title: "Mulch Installation",
    description: "Supply and install mulch in garden beds.",
    items: [
      { id: "1", type: "material", description: "Mulch", quantity: 4, unit: "yard", unitPrice: 68 },
      { id: "2", type: "labor", description: "Bed prep and installation", quantity: 5, unit: "hour", unitPrice: 55 },
      { id: "3", type: "equipment", description: "Delivery / equipment", quantity: 1, unit: "flat", unitPrice: 85 }
    ]
  },
  {
    name: "Sod Repair",
    title: "Sod Repair",
    description: "Remove damaged grass and install fresh sod.",
    items: [
      { id: "1", type: "material", description: "Premium sod", quantity: 350, unit: "sqft", unitPrice: 1.25 },
      { id: "2", type: "labor", description: "Prep and install sod", quantity: 7, unit: "hour", unitPrice: 58 }
    ]
  },
  {
    name: "Garden Cleanup",
    title: "Garden Bed Cleanup",
    description: "Clean garden beds, remove weeds and debris.",
    items: [
      { id: "1", type: "labor", description: "Garden bed cleanup", quantity: 4, unit: "hour", unitPrice: 55 },
      { id: "2", type: "material", description: "Disposal bags / materials", quantity: 1, unit: "flat", unitPrice: 35 }
    ]
  },
  {
    name: "River Rock",
    title: "River Rock Installation",
    description: "Supply and install decorative river rock.",
    items: [
      { id: "1", type: "material", description: "River rock", quantity: 2, unit: "yard", unitPrice: 185 },
      { id: "2", type: "labor", description: "Fabric, prep and installation", quantity: 8, unit: "hour", unitPrice: 60 },
      { id: "3", type: "equipment", description: "Delivery", quantity: 1, unit: "flat", unitPrice: 95 }
    ]
  }
];
