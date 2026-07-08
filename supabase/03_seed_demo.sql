-- Demo seed without auth users. Use this to confirm tables, UI mapping and relationships.
insert into organizations (id, name, slug) values
('00000000-0000-0000-0000-000000000001', 'Damasio Seasons', 'damasio-seasons')
on conflict do nothing;

insert into customers (id, organization_id, full_name, email, phone) values
('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Customer Demo','customer@email.com','905-555-0101'),
('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','John Smith','john@email.com','905-555-0102'),
('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','Maria Costa','maria@email.com','905-555-0103')
on conflict do nothing;

insert into crews (id, organization_id, name) values
('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Crew A'),
('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','Crew B')
on conflict do nothing;

insert into employees (id, organization_id, crew_id, full_name, email) values
('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Filipe','employee@demo.com'),
('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Crew B Worker','workerb@demo.com')
on conflict do nothing;

insert into properties (id, organization_id, customer_id, address_line1, city, province, lot_size, grass_height, gate, dog, irrigation, access_notes) values
('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','123 King St','Hamilton','ON','small','3in',true,false,false,'Gate on left side.'),
('40000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','123 King St','Hamilton','ON','legacy','3in',false,false,false,'Side strip near fence.'),
('40000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','45 Lakeshore','Hamilton','ON','small','2in',false,true,false,'Dog may be outside.')
on conflict do nothing;

insert into tasks (organization_id, customer_id, property_id, assigned_employee_id, assigned_crew_id, title, customer_issue, priority, status, scheduled_date, assigned_at) values
('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Return visit required','Customer said side strip near fence was missed.','urgent','assigned',current_date,now()),
('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003',null,null,'Blow driveway again','Customer reported clippings left on driveway.','normal','open',null,null);
