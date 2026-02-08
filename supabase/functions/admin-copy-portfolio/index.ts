import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CopyRequest {
  sourcePortfolioId: string;
  targetUserId: string;
  newPortfolioName?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    // Create admin client for privileged operations
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if user is admin
    const { data: adminRole } = await supabaseAdmin
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (!adminRole) {
      return new Response(
        JSON.stringify({ error: 'Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse request body
    const { sourcePortfolioId, targetUserId, newPortfolioName }: CopyRequest = await req.json();

    if (!sourcePortfolioId || !targetUserId) {
      return new Response(
        JSON.stringify({ error: 'sourcePortfolioId and targetUserId are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify source portfolio belongs to the admin
    const { data: sourcePortfolio, error: sourceError } = await supabaseAdmin
      .from('portfolios')
      .select('*')
      .eq('id', sourcePortfolioId)
      .eq('user_id', user.id)
      .single();

    if (sourceError || !sourcePortfolio) {
      return new Response(
        JSON.stringify({ error: 'Source portfolio not found or does not belong to you' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify target user exists
    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .eq('user_id', targetUserId)
      .single();

    if (!targetProfile) {
      return new Response(
        JSON.stringify({ error: 'Target user not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ====== START COPY PROCESS ======

    // 1. Create new portfolio for target user
    const portfolioName = newPortfolioName || `Copia di ${sourcePortfolio.name}`;
    const { data: newPortfolio, error: createError } = await supabaseAdmin
      .from('portfolios')
      .insert({
        user_id: targetUserId,
        name: portfolioName,
        total_value: sourcePortfolio.total_value,
        cash_value: sourcePortfolio.cash_value,
        initial_value: sourcePortfolio.initial_value,
        initial_date: sourcePortfolio.initial_date,
        deposits: sourcePortfolio.deposits,
        average_balance: sourcePortfolio.average_balance,
        average_balance_date: sourcePortfolio.average_balance_date,
        snapshot_date: sourcePortfolio.snapshot_date,
      })
      .select()
      .single();

    if (createError || !newPortfolio) {
      throw new Error(`Failed to create portfolio: ${createError?.message}`);
    }

    const newPortfolioId = newPortfolio.id;

    // 2. Copy positions (with ID mapping for overrides)
    const { data: sourcePositions } = await supabaseAdmin
      .from('positions')
      .select('*')
      .eq('portfolio_id', sourcePortfolioId);

    const positionIdMap: Record<string, string> = {};

    if (sourcePositions && sourcePositions.length > 0) {
      for (const pos of sourcePositions) {
        const oldId = pos.id;
        const { id, created_at, updated_at, portfolio_id, ...positionData } = pos;
        
        const { data: newPos, error: posError } = await supabaseAdmin
          .from('positions')
          .insert({
            ...positionData,
            portfolio_id: newPortfolioId,
          })
          .select()
          .single();

        if (posError) {
          console.error('Position copy error:', posError);
        } else if (newPos) {
          positionIdMap[oldId] = newPos.id;
        }
      }
    }

    // 3. Copy deposits
    const { data: sourceDeposits } = await supabaseAdmin
      .from('deposits')
      .select('*')
      .eq('portfolio_id', sourcePortfolioId);

    if (sourceDeposits && sourceDeposits.length > 0) {
      const depositsToInsert = sourceDeposits.map(({ id, created_at, updated_at, portfolio_id, ...deposit }) => ({
        ...deposit,
        portfolio_id: newPortfolioId,
      }));

      await supabaseAdmin.from('deposits').insert(depositsToInsert);
    }

    // 4. Copy historical_data
    const { data: sourceHistorical } = await supabaseAdmin
      .from('historical_data')
      .select('*')
      .eq('portfolio_id', sourcePortfolioId);

    if (sourceHistorical && sourceHistorical.length > 0) {
      const historicalToInsert = sourceHistorical.map(({ id, created_at, updated_at, portfolio_id, ...data }) => ({
        ...data,
        portfolio_id: newPortfolioId,
      }));

      await supabaseAdmin.from('historical_data').insert(historicalToInsert);
    }

    // 5. Copy derivative_overrides (remapping position IDs)
    const { data: sourceOverrides } = await supabaseAdmin
      .from('derivative_overrides')
      .select('*')
      .eq('portfolio_id', sourcePortfolioId);

    if (sourceOverrides && sourceOverrides.length > 0) {
      const overridesToInsert = sourceOverrides.map(({ id, created_at, updated_at, portfolio_id, ...override }) => ({
        ...override,
        portfolio_id: newPortfolioId,
        position_id: override.position_id ? (positionIdMap[override.position_id] || null) : null,
        linked_stock_id: override.linked_stock_id ? (positionIdMap[override.linked_stock_id] || null) : null,
        sold_put_id: override.sold_put_id ? (positionIdMap[override.sold_put_id] || null) : null,
        bought_put_id: override.bought_put_id ? (positionIdMap[override.bought_put_id] || null) : null,
        sold_call_id: override.sold_call_id ? (positionIdMap[override.sold_call_id] || null) : null,
        bought_call_id: override.bought_call_id ? (positionIdMap[override.bought_call_id] || null) : null,
      }));

      await supabaseAdmin.from('derivative_overrides').insert(overridesToInsert);
    }

    // 6. Copy covered_call_premiums
    const { data: sourcePremiums } = await supabaseAdmin
      .from('covered_call_premiums')
      .select('*')
      .eq('portfolio_id', sourcePortfolioId);

    if (sourcePremiums && sourcePremiums.length > 0) {
      const premiumsToInsert = sourcePremiums.map(({ id, created_at, updated_at, portfolio_id, ...premium }) => ({
        ...premium,
        portfolio_id: newPortfolioId,
      }));

      await supabaseAdmin.from('covered_call_premiums').insert(premiumsToInsert);
    }

    // Return success with summary
    return new Response(
      JSON.stringify({
        success: true,
        newPortfolioId,
        summary: {
          positions: Object.keys(positionIdMap).length,
          deposits: sourceDeposits?.length || 0,
          historicalData: sourceHistorical?.length || 0,
          overrides: sourceOverrides?.length || 0,
          premiums: sourcePremiums?.length || 0,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Copy portfolio error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
