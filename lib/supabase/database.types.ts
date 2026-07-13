export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = "admin" | "employee" | "customer";
export type ServiceFrequency = "weekly" | "biweekly" | "monthly" | "adaptive" | "one_time";
export type TaskStatus = "open" | "assigned" | "in_progress" | "returned_to_admin" | "resolved" | "cancelled";
export type VisitStatus = "scheduled" | "on_the_way" | "in_progress" | "completed" | "cancelled";

export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      customers: { Row: Customer; Insert: Partial<Customer>; Update: Partial<Customer> };
      employees: { Row: Employee; Insert: Partial<Employee>; Update: Partial<Employee> };
      crews: { Row: Crew; Insert: Partial<Crew>; Update: Partial<Crew> };
      properties: { Row: Property; Insert: Partial<Property>; Update: Partial<Property> };
      service_requests: { Row: ServiceRequest; Insert: Partial<ServiceRequest>; Update: Partial<ServiceRequest> };
      tasks: { Row: Task; Insert: Partial<Task>; Update: Partial<Task> };
      visits: { Row: Visit; Insert: Partial<Visit>; Update: Partial<Visit> };
      photos: { Row: Photo; Insert: Partial<Photo>; Update: Partial<Photo> };
      jobs: { Row: Job; Insert: Partial<Job>; Update: Partial<Job> };
      routes: { Row: Route; Insert: Partial<Route>; Update: Partial<Route> };
      quotes: { Row: Quote; Insert: Partial<Quote>; Update: Partial<Quote> };
      invoices: { Row: Invoice; Insert: Partial<Invoice>; Update: Partial<Invoice> };
      payments: { Row: Payment; Insert: Partial<Payment>; Update: Partial<Payment> };
      route_map_cache: { Row: RouteMapCacheRow; Insert: Partial<RouteMapCacheRow>; Update: Partial<RouteMapCacheRow> };
      route_map_rebuild_queue: { Row: RouteMapRebuildQueueRow; Insert: Partial<RouteMapRebuildQueueRow>; Update: Partial<RouteMapRebuildQueueRow> };
    };
    Views: Record<string, never>;
    Functions: {
      database_health_check: {
        Args: Record<string, never>;
        Returns: Json;
      };
      storage_health_check: {
        Args: Record<string, never>;
        Returns: Json;
      };
      get_customer_property_directory: {
        Args: Record<string, never>;
        Returns: Json;
      };
      create_customer_property: {
        Args: Record<string, Json>;
        Returns: Json;
      };
    };
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
};

export type Profile = {
  id: string;
  organization_id: string | null;
  role: AppRole;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  active: boolean;
  created_at: string;
};

export type Customer = {
  id: string;
  organization_id: string;
  profile_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
};

export type Crew = { id: string; organization_id: string; name: string; active: boolean; created_at: string };
export type Employee = { id: string; organization_id: string; profile_id: string | null; crew_id: string | null; full_name: string; email: string | null; phone: string | null; active: boolean; created_at: string };

export type Property = {
  id: string;
  organization_id: string;
  customer_id: string;
  official_photo_url: string | null;
  address_line1: string;
  city: string;
  province: string;
  postal_code: string | null;
  country: string;
  lot_size: "xs" | "small" | "legacy" | "oversize" | null;
  grass_height: "2in" | "3in" | "4in" | "5in" | null;
  gate: boolean;
  dog: boolean;
  irrigation: boolean;
  access_notes: string | null;
  property_notes: string | null;
  latitude: number | null;
  longitude: number | null;
  geocoded_at: string | null;
  geocode_provider: string | null;
  geocode_status: "not_mapped" | "mapped" | "failed" | "needs_review";
  created_at: string;
};

export type RouteMapCacheRow = { route_id: string; company_id: string; geometry: Json | null; bounds: Json | null; distance_meters: number | null; duration_seconds: number | null; points_hash: string; status: "pending" | "ready" | "failed"; provider: string | null; error_message: string | null; rebuilt_at: string | null; updated_at: string };
export type RouteMapRebuildQueueRow = { route_id: string; company_id: string; reason: string; attempts: number; requested_at: string; locked_at: string | null; last_error: string | null };

export type ServiceRequest = { id: string; organization_id: string; customer_id: string | null; property_id: string | null; service_name: string; message: string | null; status: string; created_at: string };
export type Job = { id: string; organization_id: string; customer_id: string | null; property_id: string | null; quote_id: string | null; invoice_id: string | null; service_name: string; frequency: ServiceFrequency; active: boolean; next_visit_date: string | null; created_at: string };
export type Route = { id: string; organization_id: string; crew_id: string | null; route_date: string; status: string; created_at: string };
export type Visit = { id: string; organization_id: string; job_id: string | null; route_id: string | null; customer_id: string | null; property_id: string | null; crew_id: string | null; assigned_employee_id: string | null; scheduled_date: string; status: VisitStatus; started_at: string | null; finished_at: string | null; duration_seconds: number | null; employee_notes: string | null; customer_visible_summary: string | null; created_at: string };

export type Task = {
  id: string;
  organization_id: string;
  customer_id: string | null;
  property_id: string | null;
  source_visit_id: string | null;
  return_visit_id: string | null;
  assigned_employee_id: string | null;
  assigned_crew_id: string | null;
  title: string;
  customer_issue: string;
  priority: "low" | "normal" | "urgent";
  status: TaskStatus;
  scheduled_date: string | null;
  assigned_at: string | null;
  returned_at: string | null;
  resolved_at: string | null;
  completion_summary: string | null;
  created_at: string;
};

export type Photo = { id: string; organization_id: string; property_id: string | null; visit_id: string | null; task_id: string | null; uploaded_by: string | null; storage_path: string; public_url: string | null; photo_type: string | null; created_at: string };
export type Quote = { id: string; organization_id: string; request_id: string | null; customer_id: string | null; property_id: string | null; quote_number: string; status: string; subtotal: number; tax: number; total: number; notes: string | null; created_at: string };
export type Invoice = { id: string; organization_id: string; quote_id: string | null; customer_id: string | null; property_id: string | null; invoice_number: string; status: string; subtotal: number; tax: number; total: number; created_at: string };
export type Payment = { id: string; organization_id: string; invoice_id: string | null; customer_id: string | null; method: string; status: string; amount: number; reference: string | null; notes: string | null; paid_at: string | null; created_at: string };
