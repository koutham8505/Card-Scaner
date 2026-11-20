do $$
declare
  matching_user_count integer;
  v_auth_user_id uuid;
  v_auth_email text;
  matching_profile_count integer;
begin
  select count(*)
    into matching_user_count
    from auth.users
   where lower(email) = lower('admin@rareminds.in');

  if matching_user_count <> 1 then
    raise exception 'Create exactly one Supabase Auth user for admin@rareminds.in before applying this migration.';
  end if;

  select id, email
    into v_auth_user_id, v_auth_email
    from auth.users
   where lower(email) = lower('admin@rareminds.in');

  select count(*)
    into matching_profile_count
    from public.staff_profiles
   where lower(email) = lower(v_auth_email);

  if matching_profile_count > 1 then
    raise exception 'Multiple staff profiles exist for admin@rareminds.in; resolve them before applying this migration.';
  elsif matching_profile_count = 1 then
    update public.staff_profiles
       set auth_user_id = v_auth_user_id,
           full_name = 'Rareminds Admin',
           email = v_auth_email,
           role = 'super_admin',
           active = true
     where lower(email) = lower(v_auth_email);
  else
    insert into public.staff_profiles(auth_user_id, full_name, email, role, active)
    values (v_auth_user_id, 'Rareminds Admin', v_auth_email, 'super_admin', true);
  end if;
end
$$;
