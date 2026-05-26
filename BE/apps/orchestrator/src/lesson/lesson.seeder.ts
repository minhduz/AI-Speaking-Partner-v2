import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, In, Repository } from 'typeorm';
import { Lesson } from './entities/lesson.entity';
import { LessonCard, ARCHIVED_CARD_ORDER_OFFSET } from './entities/lesson-card.entity';
import { CardAttempt } from './entities/card-attempt.entity';

interface SeedCard {
  type: string;
  title: string;
  task_template: string;
  success_criteria: string[];
  expected_duration_seconds: number;
}
interface SeedLesson {
  level: string;
  topic: string;
  unit: string;
  order_index: number;
  title: string;
  objective: string;
  mini_plan_text: string;
  pass_score: number;
  is_review: boolean;
  cards: SeedCard[];
}

// Demo curriculum: 15 lessons, 3 units of 5, fully linear (next_lesson_id chain).
const DEMO_A1_LESSONS: SeedLesson[] = [
  // ────────────────────────────────────────────────────────────────────────
  // Unit 1 — About Me (0..4)
  // ────────────────────────────────────────────────────────────────────────
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'About Me',
    order_index: 0,
    title: 'Introduce yourself',
    objective: 'Tell someone your name, where you live, and one thing you like.',
    mini_plan_text:
      'Warm up with a simple greeting → practice three core sentences (name / city / one thing you like) → a tiny roleplay → a 30-second self-intro.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'simple_explanation',
        title: 'Say "hi"',
        task_template:
          'Say hi to me. Then say your name in one sentence, like: "Hi, I\'m ___." Speak slowly and clearly.',
        success_criteria: ['greets', 'states own name', 'one short sentence'],
        expected_duration_seconds: 30,
      },
      {
        type: 'vocabulary_in_context',
        title: 'Three core sentences',
        task_template:
          'Now tell me three short sentences in English: (1) your name, (2) the city you live in, (3) one thing you like (a food, a sport, or a hobby).',
        success_criteria: ['three sentences', 'names city', 'states one like'],
        expected_duration_seconds: 45,
      },
      {
        type: 'roleplay',
        title: 'Meeting someone new',
        task_template:
          'Pretend we just met at a coffee shop. I\'ll say "Hi, nice to meet you!" — you greet me back and introduce yourself in 2-3 sentences.',
        success_criteria: ['greets back', 'introduces self', 'sounds natural'],
        expected_duration_seconds: 45,
      },
      {
        type: 'final_boss',
        title: '30-second self-intro',
        task_template:
          'Final task: speak for about 30 seconds. Introduce yourself fully — name, city, what you do, and one thing you like. Use everything you just practiced.',
        success_criteria: ['speaks ~30 seconds', 'covers name + city + like', 'uses simple English'],
        expected_duration_seconds: 60,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'About Me',
    order_index: 1,
    title: 'Talk about things you like',
    objective: 'Describe what you like and dislike using simple sentences.',
    mini_plan_text:
      'Name three things you like → say why → compare a like vs. a dislike → string it together as one short answer.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'vocabulary_in_context',
        title: 'Three things you like',
        task_template:
          'Tell me three short sentences using "I like ___." Try to use a food, an activity, and a place.',
        success_criteria: ['three sentences', 'uses "I like"', 'three categories'],
        expected_duration_seconds: 45,
      },
      {
        type: 'simple_explanation',
        title: 'Say why',
        task_template:
          'Pick ONE thing you like and tell me why in 1-2 sentences. Use "because" if you can. Example: "I like coffee because it makes me happy."',
        success_criteria: ['gives a reason', 'uses "because" if possible', 'one to two sentences'],
        expected_duration_seconds: 45,
      },
      {
        type: 'roleplay',
        title: '"What do you like?"',
        task_template:
          'I\'ll ask: "What do you like to do in your free time?" — answer naturally in 2-3 sentences, with one like and one short reason.',
        success_criteria: ['answers the question', 'mentions a like', 'gives a small reason'],
        expected_duration_seconds: 45,
      },
      {
        type: 'final_boss',
        title: 'Likes in 45 seconds',
        task_template:
          'Speak for about 45 seconds. Tell me two things you like and one thing you don\'t like. Add a short reason for each.',
        success_criteria: ['speaks ~45 seconds', 'covers likes and a dislike', 'reasons included'],
        expected_duration_seconds: 60,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'About Me',
    order_index: 2,
    title: 'Talk about your daily routine',
    objective: 'Describe a normal day using "I + verb" sentences and basic time words.',
    mini_plan_text:
      'Practice morning words → say what you do in the afternoon → talk about evenings → string it together as one day.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'simple_explanation',
        title: 'Morning words',
        task_template:
          'Tell me three things you do in the morning. Use sentences like "I wake up at ___" or "I drink coffee." Three short sentences.',
        success_criteria: ['three sentences', 'uses simple time words', 'present tense'],
        expected_duration_seconds: 45,
      },
      {
        type: 'vocabulary_in_context',
        title: 'Afternoon + evening',
        task_template:
          'Now in 3-4 sentences, tell me what you usually do in the afternoon AND in the evening. Use "in the afternoon" and "in the evening" once each.',
        success_criteria: ['uses both time phrases', 'present tense', 'clear actions'],
        expected_duration_seconds: 60,
      },
      {
        type: 'real_situation',
        title: '"What did you do today?"',
        task_template:
          'A friend asks: "What did you do today?" — answer simply in 2-3 sentences. Past tense is okay but "today I + verb" is fine.',
        success_criteria: ['answers the question', 'two or three actions', 'understandable'],
        expected_duration_seconds: 45,
      },
      {
        type: 'final_boss',
        title: 'A day in 45 seconds',
        task_template:
          'Speak for about 45 seconds. Describe one normal day: morning, afternoon, evening. Use "first / then / after that" if you can.',
        success_criteria: ['speaks ~45 seconds', 'covers 3 parts of day', 'uses sequence words'],
        expected_duration_seconds: 75,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'About Me',
    order_index: 3,
    title: 'Talk about family or friends',
    objective: 'Describe one or two people close to you in simple sentences.',
    mini_plan_text:
      'Learn the people-words → describe one person → answer "who do you spend time with?" → tell a tiny story.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'vocabulary_in_context',
        title: 'People words',
        task_template:
          'Use these three words in one sentence each: "friend", "family", and one of "brother / sister / cousin / parent". Example: "My best friend is funny."',
        success_criteria: ['uses each word once', 'three short sentences', 'simple English'],
        expected_duration_seconds: 45,
      },
      {
        type: 'real_situation',
        title: 'Describe one person',
        task_template:
          'Pick ONE family member or friend. In 2-3 sentences, tell me: who they are, what they do, and one thing about their personality.',
        success_criteria: ['names the person and role', 'mentions what they do', 'one trait'],
        expected_duration_seconds: 60,
      },
      {
        type: 'roleplay',
        title: '"Who do you spend time with?"',
        task_template:
          'I will ask: "Who do you spend time with most days?" — answer in 2-3 sentences. Say who, and one short detail about them.',
        success_criteria: ['answers the question', 'names at least one person', 'adds a detail'],
        expected_duration_seconds: 45,
      },
      {
        type: 'final_boss',
        title: 'People in 45 seconds',
        task_template:
          'Speak for about 45 seconds about a family member or close friend. Who they are, one thing about them, and one thing you do together.',
        success_criteria: ['speaks ~45 seconds', 'covers person + activity', 'mostly English'],
        expected_duration_seconds: 60,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'About Me',
    order_index: 4,
    title: 'Review: About Me',
    objective:
      'Combine self-introduction, likes, routine, and people into one smooth mini-talk.',
    mini_plan_text:
      'Warm up by introducing yourself → bring in your routine and one person → one combined mini-talk.',
    pass_score: 70,
    is_review: true,
    cards: [
      {
        type: 'simple_explanation',
        title: 'Quick self-intro',
        task_template:
          'In two sentences, tell me your name and where you live. Speak naturally — this is just a warm-up.',
        success_criteria: ['two sentences', 'name + city', 'clear pronunciation'],
        expected_duration_seconds: 30,
      },
      {
        type: 'real_situation',
        title: 'Add a person and a like',
        task_template:
          'Continue: in 3 sentences, tell me one person close to you and one thing you like to do. Connect them if possible.',
        success_criteria: ['mentions a person', 'mentions a like', 'connected to intro'],
        expected_duration_seconds: 45,
      },
      {
        type: 'final_boss',
        title: 'About Me — 60 seconds',
        task_template:
          'Speak for 60 seconds. Combine everything: who you are, the people around you, what you like, and what a normal day looks like. Try to sound like one connected talk, not four answers.',
        success_criteria: [
          'speaks for ~60 seconds',
          'covers self + people + likes + routine',
          'feels connected, not robotic',
        ],
        expected_duration_seconds: 75,
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Unit 2 — Everyday Survival (5..9)
  // ────────────────────────────────────────────────────────────────────────
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Everyday Survival',
    order_index: 5,
    title: 'Order food or drink',
    objective: 'Order something at a cafe or restaurant using simple polite phrases.',
    mini_plan_text:
      'Learn polite order phrases → ask one small question → roleplay an order → handle a follow-up.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'simple_explanation',
        title: 'Polite phrases',
        task_template:
          'Say these three phrases out loud: "Can I have ___, please?", "I\'ll take ___.", "Could I get ___?" Use each one in a short order.',
        success_criteria: ['uses each phrase', 'clear pronunciation', 'sounds polite'],
        expected_duration_seconds: 45,
      },
      {
        type: 'vocabulary_in_context',
        title: 'Ask a small question',
        task_template:
          'Ask me one question about a drink or a food item. Examples: "Is it sweet?" "Does it come with milk?" "What size is the regular?" One question, then your order.',
        success_criteria: ['asks one question', 'follows with an order', 'simple words'],
        expected_duration_seconds: 45,
      },
      {
        type: 'roleplay',
        title: 'At the counter',
        task_template:
          'I am the barista. I say: "Hi! What can I get for you?" — greet, ask one question, and order a drink and one food item. End with "Thank you."',
        success_criteria: ['greets and orders', 'asks one question', 'ends politely'],
        expected_duration_seconds: 60,
      },
      {
        type: 'final_boss',
        title: 'Handle a follow-up',
        task_template:
          'Same scene, longer. I will ask a follow-up like "For here or to go?" or "Anything else?" — order, answer the follow-up, and finish the order in 45-60 seconds.',
        success_criteria: ['answers the follow-up', 'finishes the order', 'sounds natural'],
        expected_duration_seconds: 75,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Everyday Survival',
    order_index: 6,
    title: 'Buy something simple',
    objective: 'Buy a small item in a shop using simple, polite English.',
    mini_plan_text:
      'Ask the price → ask one detail → make the purchase → say thanks and leave.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'vocabulary_in_context',
        title: 'Ask the price',
        task_template:
          'Use three phrases out loud: "How much is this?", "Do you have a smaller size?", "Can I pay by card?" Three short sentences, one per line.',
        success_criteria: ['uses each phrase', 'clear pronunciation', 'sounds polite'],
        expected_duration_seconds: 45,
      },
      {
        type: 'real_situation',
        title: 'Ask a detail',
        task_template:
          'You want to buy a T-shirt. In 2 sentences, ask the staff for ONE detail (color, size, price, or material). Keep it short and clear.',
        success_criteria: ['asks one clear detail', 'two short sentences', 'simple words'],
        expected_duration_seconds: 45,
      },
      {
        type: 'roleplay',
        title: 'At the shop',
        task_template:
          'I am the shop staff. I say: "Hi, can I help you?" — say what you want, ask the price, and decide if you\'ll take it. Three to four short turns.',
        success_criteria: ['says what you want', 'asks the price', 'makes a decision'],
        expected_duration_seconds: 60,
      },
      {
        type: 'final_boss',
        title: 'Pay and leave',
        task_template:
          'Same scene, finish the purchase. Pay by card or cash, ask for a bag if you need one, thank the staff. Speak for about 45 seconds.',
        success_criteria: ['pays politely', 'asks about bag or receipt', 'ends with thanks'],
        expected_duration_seconds: 60,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Everyday Survival',
    order_index: 7,
    title: 'Ask for directions',
    objective: 'Ask a stranger how to get somewhere using simple polite English.',
    mini_plan_text:
      'Learn the opening phrase → ask where → understand the direction → say thanks.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'simple_explanation',
        title: 'Polite opener',
        task_template:
          'Say these three openers out loud: "Excuse me, do you speak English?", "Excuse me, could you help me?", "Sorry to bother you — quick question?" Pick the one that feels natural and use it.',
        success_criteria: ['uses a polite opener', 'sounds friendly', 'clear pronunciation'],
        expected_duration_seconds: 30,
      },
      {
        type: 'vocabulary_in_context',
        title: 'Ask where',
        task_template:
          'Ask three short questions: "Where is the ___?", "How do I get to ___?", "Is it far from here?" Use a real place like a bus stop, a bank, or a coffee shop.',
        success_criteria: ['three questions', 'real place mentioned', 'present tense'],
        expected_duration_seconds: 45,
      },
      {
        type: 'roleplay',
        title: 'Lost on the street',
        task_template:
          'You\'re looking for the nearest coffee shop. I\'m a local. Approach me politely, ask where the coffee shop is, and ask one follow-up like "Is it walking distance?"',
        success_criteria: ['uses polite opener', 'asks the location', 'asks a follow-up'],
        expected_duration_seconds: 60,
      },
      {
        type: 'final_boss',
        title: 'Repeat the directions',
        task_template:
          'After I give you directions, say them back to me in your own words ("So — go straight, then turn left, right?"). Then thank me and finish.',
        success_criteria: ['repeats back the directions', 'confirms understanding', 'ends with thanks'],
        expected_duration_seconds: 60,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Everyday Survival',
    order_index: 8,
    title: 'Make a simple plan',
    objective: 'Suggest a time and place to meet someone using simple English.',
    mini_plan_text:
      'Suggest something → suggest a time → handle a small change → confirm the plan.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'vocabulary_in_context',
        title: 'Suggest something',
        task_template:
          'Use each phrase in a short sentence: "Do you want to ___?", "How about ___?", "Let\'s ___." Three short, natural suggestions.',
        success_criteria: ['uses each phrase', 'three sentences', 'sounds natural'],
        expected_duration_seconds: 45,
      },
      {
        type: 'simple_explanation',
        title: 'Pick a time and place',
        task_template:
          'In 2 sentences, suggest a time and a place to meet a friend. Use "at" for time and place. Example: "Let\'s meet at 7 pm at the coffee shop near the park."',
        success_criteria: ['mentions time and place', 'uses "at" twice', 'two clear sentences'],
        expected_duration_seconds: 45,
      },
      {
        type: 'roleplay',
        title: 'Making plans with a friend',
        task_template:
          'I\'m your friend. I say: "Are you free this weekend?" — suggest something to do, pick a time, and pick a place. 3-4 short turns.',
        success_criteria: ['suggests an activity', 'gives time and place', 'sounds friendly'],
        expected_duration_seconds: 60,
      },
      {
        type: 'final_boss',
        title: 'Handle a small change',
        task_template:
          'Same conversation. I say "Actually, can we do 8 pm instead?" — agree or politely suggest a different time, then confirm the new plan in one clear sentence.',
        success_criteria: ['responds to the change', 'suggests or agrees', 'confirms the final plan'],
        expected_duration_seconds: 60,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Everyday Survival',
    order_index: 9,
    title: 'Review: Everyday Survival',
    objective:
      'Combine ordering, buying, asking directions, and making plans into one realistic mini-scene.',
    mini_plan_text:
      'Warm up by asking for a place → order something → make a small plan with someone you meet.',
    pass_score: 70,
    is_review: true,
    cards: [
      {
        type: 'real_situation',
        title: 'Find a cafe',
        task_template:
          'You\'re new in town. Politely ask me where a good coffee shop is. Two short sentences max.',
        success_criteria: ['polite opener', 'asks for a place', 'simple English'],
        expected_duration_seconds: 30,
      },
      {
        type: 'roleplay',
        title: 'Order and chat',
        task_template:
          'You\'re at the cafe. Order a drink, ask one question, and chat for one short turn with the barista (e.g. "Is it always this busy?"). 3-4 short turns.',
        success_criteria: ['orders clearly', 'asks one question', 'one tiny social turn'],
        expected_duration_seconds: 60,
      },
      {
        type: 'final_boss',
        title: 'Survive a 60-second scene',
        task_template:
          'Speak for about 60 seconds. Combine: ask directions → order something → make a plan with someone to come back later. One connected scene.',
        success_criteria: [
          'covers all three actions',
          'sounds like one connected scene',
          'mostly accurate simple English',
        ],
        expected_duration_seconds: 75,
      },
    ],
  },

  // ────────────────────────────────────────────────────────────────────────
  // Unit 3 — Real Conversation (10..14)
  // ────────────────────────────────────────────────────────────────────────
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Real Conversation',
    order_index: 10,
    title: 'Work or study small talk',
    objective: 'Talk about what you do for work or study in a short, natural way.',
    mini_plan_text:
      'Name what you do → say one thing about it → answer a follow-up → keep the small talk going.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'simple_explanation',
        title: 'Name what you do',
        task_template:
          'In one sentence, tell me what you do. Examples: "I\'m a student." "I work in marketing." "I\'m a software engineer." One clear sentence.',
        success_criteria: ['one clear sentence', 'states role', 'present tense'],
        expected_duration_seconds: 30,
      },
      {
        type: 'vocabulary_in_context',
        title: 'One thing about it',
        task_template:
          'Add 2 sentences. One thing you like about your work/study, and one thing that is hard. Example: "I like working with people. The deadlines are tough."',
        success_criteria: ['one like', 'one hard thing', 'two short sentences'],
        expected_duration_seconds: 45,
      },
      {
        type: 'real_situation',
        title: '"What do you do?"',
        task_template:
          'I just met you at an event. I ask: "So, what do you do?" — answer in 2-3 sentences. Say what you do and one short detail.',
        success_criteria: ['answers the question', 'adds one detail', 'sounds natural'],
        expected_duration_seconds: 45,
      },
      {
        type: 'final_boss',
        title: 'Keep the small talk going',
        task_template:
          'Same scene. After your answer, ask me back: "What about you?" — listen, then react in one short sentence. Goal: short, friendly back-and-forth for about 45 seconds.',
        success_criteria: ['asks back', 'reacts to my answer', 'feels like real small talk'],
        expected_duration_seconds: 60,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Real Conversation',
    order_index: 11,
    title: 'Give a simple opinion',
    objective: 'Share a short opinion with a reason using simple English.',
    mini_plan_text:
      'Learn opinion phrases → give a reason → agree or politely disagree → defend your opinion shortly.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'vocabulary_in_context',
        title: 'Opinion phrases',
        task_template:
          'Use each phrase in one sentence: "I think ___.", "In my opinion ___.", "For me, ___ is ___." Three short sentences on any topic.',
        success_criteria: ['uses each phrase', 'three sentences', 'simple English'],
        expected_duration_seconds: 45,
      },
      {
        type: 'simple_explanation',
        title: 'Add a reason',
        task_template:
          'Pick a topic (food, movies, weather, your city). Give your opinion and a short reason. Use "because" once. One opinion, one reason.',
        success_criteria: ['gives an opinion', 'gives a reason', 'uses "because"'],
        expected_duration_seconds: 45,
      },
      {
        type: 'roleplay',
        title: 'Friendly debate',
        task_template:
          'I\'ll say: "I think pizza is overrated." — agree or politely disagree in 2 sentences. Use "I agree" or "I don\'t really agree" with a short reason.',
        success_criteria: ['agrees or disagrees', 'gives a reason', 'stays polite'],
        expected_duration_seconds: 45,
      },
      {
        type: 'final_boss',
        title: 'Defend your opinion',
        task_template:
          'Speak for about 45 seconds. Give an opinion you really hold (about food, a city, or a hobby), give two reasons, and finish with "What do you think?"',
        success_criteria: ['clear opinion', 'two reasons', 'invites my view'],
        expected_duration_seconds: 75,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Real Conversation',
    order_index: 12,
    title: 'Talk about a past experience',
    objective: 'Share something you did recently using simple past tense.',
    mini_plan_text:
      'Practice past verbs → tell what you did → add one feeling → answer a follow-up.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'vocabulary_in_context',
        title: 'Past verbs',
        task_template:
          'Use each verb in past tense once: "go → went", "eat → ate", "see → saw". Three short sentences about yesterday.',
        success_criteria: ['uses each past form', 'three sentences', 'about yesterday'],
        expected_duration_seconds: 45,
      },
      {
        type: 'real_situation',
        title: 'Last weekend',
        task_template:
          'In 3 sentences, tell me one thing you did last weekend. What you did, who you were with, and one detail.',
        success_criteria: ['three sentences', 'one activity', 'one person + one detail'],
        expected_duration_seconds: 60,
      },
      {
        type: 'simple_explanation',
        title: 'Add a feeling',
        task_template:
          'Now add one feeling about that experience. Example: "It was really fun." or "I was a bit tired." One sentence about how you felt.',
        success_criteria: ['mentions a feeling', 'past tense feeling', 'one clear sentence'],
        expected_duration_seconds: 30,
      },
      {
        type: 'final_boss',
        title: '"Tell me about last weekend"',
        task_template:
          'I ask: "So, what did you do last weekend?" — speak for about 45 seconds. Cover what you did, who with, one detail, one feeling.',
        success_criteria: ['speaks ~45 seconds', 'past tense throughout', 'covers all four points'],
        expected_duration_seconds: 60,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Real Conversation',
    order_index: 13,
    title: 'Talk about future plans',
    objective: 'Share what you plan to do soon using "going to" and "will".',
    mini_plan_text:
      'Practice future phrases → share a plan → answer "when?" → connect plans to a goal.',
    pass_score: 70,
    is_review: false,
    cards: [
      {
        type: 'simple_explanation',
        title: 'Future phrases',
        task_template:
          'Use each phrase in one sentence: "I\'m going to ___.", "I will ___.", "I\'m planning to ___." Three sentences about something coming up.',
        success_criteria: ['uses each phrase', 'three sentences', 'future meaning'],
        expected_duration_seconds: 45,
      },
      {
        type: 'vocabulary_in_context',
        title: 'When?',
        task_template:
          'In 2 sentences, share one plan and when it will happen. Use a clear time word: tonight, tomorrow, next week, this weekend.',
        success_criteria: ['shares a plan', 'mentions a time word', 'two sentences'],
        expected_duration_seconds: 45,
      },
      {
        type: 'real_situation',
        title: 'Plans for the week',
        task_template:
          'In 3 sentences, tell me one thing you\'re going to do this week, one thing next week, and one bigger plan for this year.',
        success_criteria: ['three different time scales', 'present continuous or going to', 'connected to you'],
        expected_duration_seconds: 60,
      },
      {
        type: 'final_boss',
        title: 'A goal and a plan',
        task_template:
          'Speak for about 45 seconds. Tell me one goal you have, one plan for this month, and one small step you\'ll do this week to get closer.',
        success_criteria: ['names a goal', 'a plan and a step', 'links plan to goal'],
        expected_duration_seconds: 75,
      },
    ],
  },
  {
    level: 'A1',
    topic: 'Daily Life',
    unit: 'Real Conversation',
    order_index: 14,
    title: 'Final review: Real Conversation',
    objective:
      'Combine small talk, opinions, past experience, and future plans into one connected conversation.',
    mini_plan_text:
      'Start with small talk → share an opinion → mention something you did → finish with a plan.',
    pass_score: 70,
    is_review: true,
    cards: [
      {
        type: 'real_situation',
        title: 'Open with small talk',
        task_template:
          'Pretend we just met. In 2 sentences, say hi, say what you do, and ask "What about you?"',
        success_criteria: ['greets', 'states what you do', 'asks back'],
        expected_duration_seconds: 30,
      },
      {
        type: 'roleplay',
        title: 'Add an opinion and a story',
        task_template:
          'Continue the chat. Share one opinion about a city, food, or hobby, then mention one thing you did recently that connects to it. 3-4 sentences.',
        success_criteria: ['gives an opinion', 'tells a short past detail', 'sounds connected'],
        expected_duration_seconds: 60,
      },
      {
        type: 'final_boss',
        title: 'Wrap with a plan — 75 seconds',
        task_template:
          'Speak for about 75 seconds. One connected conversation: small talk → opinion → something you did recently → plan for next week. End naturally, like closing a real chat.',
        success_criteria: [
          'speaks ~75 seconds',
          'covers all four parts',
          'sounds like one real conversation',
        ],
        expected_duration_seconds: 75,
      },
    ],
  },
];

@Injectable()
export class LessonSeeder implements OnModuleInit {
  private readonly log = new Logger('LessonSeeder');

  constructor(
    @InjectRepository(Lesson) private lessons: Repository<Lesson>,
    @InjectRepository(LessonCard) private cards: Repository<LessonCard>,
    @InjectRepository(CardAttempt) private cardAttempts: Repository<CardAttempt>,
  ) {}

  async onModuleInit() {
    try {
      await this.seed();
    } catch (err: any) {
      this.log.warn(`Seed skipped: ${err?.message ?? err}`);
    }
  }

  /**
   * Idempotent upsert for the 15 demo A1 lessons. Stable key is
   * (level, topic, order_index). Does NOT touch user attempts, progress,
   * sessions, card attempts, or teacher reviews — only the lesson/card rows.
   *
   * Old A1/Daily Life lessons that fall outside order_index 0..14 are
   * unpublished (not deleted) so historical references stay intact.
   */
  private async seed() {
    const orderIndices = DEMO_A1_LESSONS.map((l) => l.order_index);

    // 1. Upsert each lesson row by (level, topic, order_index).
    const persisted: Lesson[] = [];
    for (const seed of DEMO_A1_LESSONS) {
      let lesson = await this.lessons.findOne({
        where: { level: seed.level, topic: seed.topic, orderIndex: seed.order_index },
      });
      if (!lesson) {
        lesson = this.lessons.create({
          level: seed.level,
          topic: seed.topic,
          unit: seed.unit,
          orderIndex: seed.order_index,
          title: seed.title,
          objective: seed.objective,
          miniPlanText: seed.mini_plan_text,
          passScore: seed.pass_score,
          isReview: seed.is_review,
          isPublished: true,
          nextLessonId: null,
        });
      } else {
        lesson.unit = seed.unit;
        lesson.title = seed.title;
        lesson.objective = seed.objective;
        lesson.miniPlanText = seed.mini_plan_text;
        lesson.passScore = seed.pass_score;
        lesson.isReview = seed.is_review;
        lesson.isPublished = true;
      }
      await this.lessons.save(lesson);
      persisted.push(lesson);

      // 2. Resync the lesson's cards: upsert by (lessonId, orderIndex) so we
      // don't break historical card_attempt.lesson_card_id links. Delete only
      // cards beyond the new card count.
      const existingCards = await this.cards.find({
        where: { lessonId: lesson.id },
        order: { orderIndex: 'ASC' },
      });
      const existingByOrder = new Map(existingCards.map((c) => [c.orderIndex, c]));
      for (let idx = 0; idx < seed.cards.length; idx++) {
        const c = seed.cards[idx];
        let card = existingByOrder.get(idx);
        if (!card) {
          card = this.cards.create({
            lessonId: lesson.id,
            orderIndex: idx,
          });
        }
        card.type = c.type;
        card.title = c.title;
        card.taskTemplate = c.task_template;
        card.successCriteria = c.success_criteria;
        card.expectedDurationSeconds = c.expected_duration_seconds;
        card.retryAllowed = true;
        await this.cards.save(card);
      }
      // Trim live cards beyond the new card count. Already-archived rows
      // (orderIndex >= ARCHIVED_CARD_ORDER_OFFSET) are left alone so the
      // archive is idempotent across reboots. Among live extras, anything
      // still referenced by a card_attempt is archived instead of deleted so
      // attempt history keeps a target.
      const extra = existingCards.filter(
        (c) => c.orderIndex >= seed.cards.length && c.orderIndex < ARCHIVED_CARD_ORDER_OFFSET,
      );
      if (extra.length > 0) {
        const extraIds = extra.map((c) => c.id);
        const referenced = await this.cardAttempts.find({
          where: { lessonCardId: In(extraIds) },
          select: { lessonCardId: true },
        });
        const referencedSet = new Set(referenced.map((r) => r.lessonCardId));
        const safeToDelete = extra.filter((c) => !referencedSet.has(c.id));
        const keepArchived = extra.filter((c) => referencedSet.has(c.id));
        if (safeToDelete.length > 0) await this.cards.remove(safeToDelete);
        if (keepArchived.length > 0) {
          this.log.warn(
            `Lesson ${lesson.id} (order ${seed.order_index}): archiving ${keepArchived.length} extra card row(s) referenced by card_attempts; they are excluded from detail/runtime reads`,
          );
          for (const c of keepArchived) {
            c.orderIndex = ARCHIVED_CARD_ORDER_OFFSET + c.orderIndex;
            await this.cards.save(c);
          }
        }
      }
    }

    // 3. Re-link next_lesson_id across the 15 lessons (sorted by order_index).
    const byIndex = new Map(persisted.map((l) => [l.orderIndex, l]));
    for (let i = 0; i < orderIndices.length; i++) {
      const curr = byIndex.get(orderIndices[i])!;
      const next = i < orderIndices.length - 1 ? byIndex.get(orderIndices[i + 1])! : null;
      const desired = next?.id ?? null;
      if (curr.nextLessonId !== desired) {
        curr.nextLessonId = desired;
        await this.lessons.save(curr);
      }
    }

    // 4. Unpublish any old A1/Daily Life lessons that don't belong to the demo
    // path (keeps history but hides them from getPath).
    const stale = await this.lessons.find({
      where: {
        level: 'A1',
        topic: 'Daily Life',
        orderIndex: Not(In(orderIndices)),
      },
    });
    for (const l of stale) {
      if (l.isPublished) {
        l.isPublished = false;
        await this.lessons.save(l);
      }
    }

    this.log.log(
      `Seeded demo A1 path: ${persisted.length} lessons (3 units), ${stale.length} legacy A1/Daily Life lessons unpublished`,
    );
  }
}
