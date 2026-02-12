import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { query, context } = await request.json();

    if (!query || !context) {
      return NextResponse.json({ error: 'Missing query or context' }, { status: 400 });
    }

    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) {
      return NextResponse.json({
        answer: 'AI search is not configured. Set ANTHROPIC_API_KEY in environment variables. Keyword search still works!',
      });
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1200,
        system: `You are an expert analyst helping a user extract actionable wisdom from founder interview transcripts collected from the Starter Story YouTube channel. 

Your job:
- Synthesize insights across multiple interviews to answer the user's question
- Reference specific founders/companies by name when possible
- Be concise, practical, and actionable
- Use concrete numbers and examples from the transcripts
- If the transcripts don't have relevant info, say so honestly
- Format with short paragraphs, no bullet points unless specifically listing items`,
        messages: [
          {
            role: 'user',
            content: `Here are relevant founder interview transcripts:\n\n${context}\n\n---\n\nBased on these interviews, answer this question:\n${query}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('Anthropic API error:', err);
      return NextResponse.json({
        answer: 'AI search temporarily unavailable. Try keyword search instead.',
      });
    }

    const data = await response.json();
    const answer = data.content?.map(b => b.text).join('') || 'No response generated.';

    return NextResponse.json({ answer });
  } catch (err) {
    console.error('AI search error:', err);
    return NextResponse.json({
      answer: 'AI search encountered an error. Keyword results are shown below.',
    });
  }
}
