-- Ceintures enfants IBJJF (grise, jaune, orange, verte, chacune en trois degrés : « et blanche », pleine, « et noire »)
-- en plus des ceintures adultes, pour les adhérents mineurs (0024).
alter table public.people drop constraint people_belt_check;
alter table public.people add constraint people_belt_check check (belt is null or belt in (
  'white', 'blue', 'purple', 'brown', 'black',
  'grey_white', 'grey', 'grey_black', 'yellow_white', 'yellow', 'yellow_black',
  'orange_white', 'orange', 'orange_black', 'green_white', 'green', 'green_black'));
