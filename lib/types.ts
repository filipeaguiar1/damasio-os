export type Lead = {
  id: string;
  createdAt: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  service: string;
  status: "new" | "quoted" | "booked" | "lost";
  subtotal: number;
  tax: number;
  total: number;
  notes?: string;
};
