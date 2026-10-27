-- One GL slip is one outfit booking, so scanning it cannot ambiguously mark multiple outfits.
-- Existing orders remain unchanged. There are no duplicate measurement IDs at migration time.
CREATE UNIQUE INDEX IF NOT EXISTS orders_one_booking_per_measurement
  ON public.orders(measurement_id)
  WHERE measurement_id IS NOT NULL;
