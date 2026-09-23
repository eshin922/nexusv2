-- Customer document may visually include associated service amounts in the
-- owning product row. Accounting continues to emit each service separately.
ALTER TABLE presentation_profile
  ADD COLUMN include_associated_services_in_product boolean NOT NULL DEFAULT false;
