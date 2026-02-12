import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { query, context } = await request.json();

    if (!query || !context) {
      return NextResponse.json({ error: 'Missing query or context' }, { status: 400 });
    }

    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) {
      return NextResponse.json({
        answer: 'AI search is not configured. Set OPENAI_API_KEY in environment variables. Keyword search still works!',
      });
    }

    const systemPrompt = `You are an expert analyst helping a user extract actionable wisdom from founder interview transcripts collected from the Starter Story YouTube channel. 

Your job:
- Synthesize insights across multiple interviews to answer the user's question
- Reference specific founders/companies by name when possible
- Be concise, practical, and actionable
- Use concrete numbers and examples from the transcripts
- If the transcripts don't have relevant info, say so honestly
- Format with short paragraphs, no bullet points unless specifically listing items`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `Based on these founder interview transcripts:\n\n${context}\n\n---\n\nQuestion: ${query}` },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI API error:', err);
      return NextResponse.json({
        answer: 'AI search temporarily unavailable. Try keyword search instead.',
      });
    }

    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content || 'No response generated.';

    return NextResponse.json({ answer });
  } catch (err) {
    console.error('AI search error:', err);
    return NextResponse.json({
      answer: 'AI search encountered an error. Keyword results are shown below.',
    });
  }
}
