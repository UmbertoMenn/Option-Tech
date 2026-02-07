-- Add DELETE policy for alerts table so users can reset their alert system
CREATE POLICY "Users can delete own alerts"
ON alerts FOR DELETE
USING (user_id = auth.uid());