-- Make every state-changing pilot operation traceable.
-- sensor_health is intentionally excluded because its primary key is device_id
-- rather than id; health telemetry is operational state, not an approval record.
begin;

drop trigger if exists evacuation_points_audit on public.evacuation_points;
create trigger evacuation_points_audit
after insert or update or delete on public.evacuation_points
for each row execute function public.audit_operations_change();

drop trigger if exists sensor_devices_audit on public.sensor_devices;
create trigger sensor_devices_audit
after insert or update or delete on public.sensor_devices
for each row execute function public.audit_operations_change();

drop trigger if exists sensor_observations_audit on public.sensor_observations;
create trigger sensor_observations_audit
after insert or update or delete on public.sensor_observations
for each row execute function public.audit_operations_change();

drop trigger if exists alert_rules_audit on public.alert_rules;
create trigger alert_rules_audit
after insert or update or delete on public.alert_rules
for each row execute function public.audit_operations_change();

drop trigger if exists alerts_audit on public.alerts;
create trigger alerts_audit
after insert or update or delete on public.alerts
for each row execute function public.audit_operations_change();

drop trigger if exists alert_deliveries_audit on public.alert_deliveries;
create trigger alert_deliveries_audit
after insert or update or delete on public.alert_deliveries
for each row execute function public.audit_operations_change();

drop trigger if exists tourism_places_audit on public.tourism_places;
create trigger tourism_places_audit
after insert or update or delete on public.tourism_places
for each row execute function public.audit_operations_change();

drop trigger if exists tourism_content_audit on public.tourism_content;
create trigger tourism_content_audit
after insert or update or delete on public.tourism_content
for each row execute function public.audit_operations_change();

commit;
