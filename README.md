# Aeryth
Chrome Built-in AI Challenge-2025, a anti-procrastination companion


I have joined chrome AI challenge 2025 to build a web applivcation using the chrome extensions and API (checek the rules on site)

The goal of what i wish to achieve is a anti procrastination AI companion that has some variety of features - called Aeryth

features that i wish to build with it:- an AI UI structure similar to the famous AI for comfortaility (already finished), Currently Phase two has been finished ut i have some changes to make before moving to phase 3 (the phases are clearly mentioned in the attached image)

So please note my changes for also the future phases 

 1. the explore or set goal is where a user starts a new chat ( a new chat when clicked by default opens explore mode) 

 the explore mode is where the user learns about and thinks of what they decide to do - so the AI is not going to start asking them to do some work before they understand the topics 

 2.Once they have explored enough they can set goal under that chat meaning the goal is linked to this chat which is their routine- when this is done their routine is mapped to calendar with the days and time recorded in it like a google calendar (which the user can open if required), the calendar option is available in the side bar at the right side (phase 4)

 3.Change the text in the following : in setting set up - change  Nagging criteria (the stop switch) to Routine criteria (only the text should be changed),in aeryth's tone remove the Manipulator term from Friendly manipulatore and make it as Friendly (default)

3.5- under the "Next Routine" area inside the sidebar of aeryth it should display the next two routines that is within the next 8 hours 



 4. the history of chats which was previously called All routines in the sidebar will be renamed to Routines and under that will be the chats of the previous explore chats unless they have deleted it 

 5. also the delete button is available for each chat which is inside the three dots at the end of the that name (similar to any AI structure) 

 6. If by chance any two routine times overlap then the set goal option is temporarily saved but returns to the explore chat of the respective set goal and say that you already have 'xx' fixed on that time so change time

7. Out of the three options - when explore is clciked- it opens a new chat once user enters any text (similar to the New chat button which should be added above the serach bar in the sidebar (below the aeryth name and above the search bar),

when set goal is clicked - it opens the tab as it is doing now and after setting the goal the time and days are registered in calendar and the routine is mapped to the current explore chat they were using for further chats and reminders and this chat is saved under the Routines (Previously All routines) like the AI saves the topic of what we chat, it has rename and delet options- so each chat is connected to a explore,set goal, and a calendar routine - making them each as a single routine chat - so when the chat topic is deletd it is removed from calendar (hence should give a warning message similar to Do you completely want to remove this goal)

Finally the third is diary which is a new chat per day - this chat is stored in backend and the summarized version is used by the AI for the report progress and tracking user 

8. I have a lot more to change on the AIs tone settings- as far as i checked the current canvas code- it is using the about you filled by the user too frequently saying that you told you are like this in each message and that is why its reply is that way- I do not want the AI to delibrately say their about status to them since this is something they feel guilty and already know, instead it should use this to find the user personality and train itself relative to that and reply the user accordingly.

-- Phase three errors to resolve:
make scrolling to more smooth instead of going up and down
make the side bar three lines proper, it displayes to icons on the same time
set goal typing has issues- enters each time after typing one letter instead of allwoing to type continuously
Diary changes:
Currently displays the new Entry and each entry is saved in the left side with the new entry coloumn: since i cannot test it for what happens when the next day arrives i want to make sure:- 
Change the Past entries into {today's date in this format 11 Oct 25}, that means the entries written on that day are mapped to this date, add a new button below the date "Past entries", when clicked the left side UI is still similar but it shows the dates of the other days before this entry arranged date wise (top is the most recent one) and when user clicks a date, it goes inside it showing the entrie sof that respective day, if tehre is no entry thenthat date is not available
Remove the summarize button for user, this is a backend tast, that summarizes the entire days entries into a single new entry called Summary of the and added to that respective date at the top of all that days entry, this is auto updated daily after the day ends, so teh structure is :
Today's Date
Past Entries button
|Entry one
|entry two....

When past entries is clicked the structue changes to
Back button - goes to current date
Past Entries:
|Date one
|Date two...
When a date is clicked 
Back button -goes to teh previous page of past entries date collection
Date chosen
|Summary - of all the entries on this date
|Entry1
|Entry2... (each entry has the time of entry in it)

Once every month inside the past entries the dates are further stored inside the month name when the next month starts - exampel if october starts all the september entry is stored inside september and also a new monthly summary is added inside that month along with the each day entries
ALso between the past entries and new entry button there is a search bar to search a specific date/month or chat or time
user can hover over the entry to delete the entry of required befor ethe day end sif not it is not possbile


##Large changes: currently the model has been running with gemni 2.5, which is cloud side, i want client side APIs using gemini nano so...

1.Main chages to be installed - the diary entry, calendar (this stores the routines) are stored in client side system locally (can ask user for destination to store data/retrieve data)
2.Since gemini nano does not remember chats it is best to remove the chat data(can be saved in system like whatsapp bbut not required) so we make it this way 
- once user sets their routine vie explore and set goal this is stored in the calendar and a new folder is created in user local storage - that is a new chat history
- since my goal is a reminder app no need to save the explore chat history so make the explore chat history like a ttemperory chatting area, instead of the chats to be saved, save the routines under the routine in the sideBAr, when we open each routine (like each chat) the routine will be a sticky note like structure where the user can type their next days goal (so the sticky note stores their previous day current and next day which can be edited by user)
- only three sticky note (user can change colour) current on top, previous and next day side by side below current day, when the day ends (the sticky notes are tagged with the dates) the app automatecially deletes the previous day and updates the current as previous (that is as per respective dates)
-as for diary they are stored in local device
-character personality and personalisation - at first the user decides the tone of the AI, and gives about them which is saved(can be changed also) under a backend file for personality, where the file is also updated each time the user uses this AI by analysing their current chat and summarising it, so each time the user uses it gets more data which is appended to the backend file, and whenevr the ai prompts it is first propmted with the user personality

Notes for me:
for the user initial persona;lity foind the four type of tutors that user requires and get the prompt that can be used for them.


Change the diary hierarchy, new chat to create new explore, date is one day ahead bacuse of utc and singapore timing can be solved by shnaging iso