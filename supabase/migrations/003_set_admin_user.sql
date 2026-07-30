-- Actualizar perfil del primer usuario a admin
-- Ejecutar en Supabase SQL Editor

UPDATE profiles
SET first_name = 'Maximiliano',
    last_name = 'Schippert',
    role = 'admin'
WHERE id = (SELECT id FROM profiles LIMIT 1);
