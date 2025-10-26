# Aeryth
Chrome Built-in AI Challenge-2025, an anti-procrastination companion

storage of the datat - not done, page resets on reload

notifications - still the notification with buttons are not visible

personalisation and notification chat

extra - create timer with pause end and start keys whose data is used for statistical view of user performance ( can be done in the extension)



1.All storage converted local storage (in device storage)
2.explain me how the storage is done in json that is the format of hhow the data is as that i scrucial for step4
3. whatever in the web application is saved in the system in a specific destination after getting permission from user
4.The extension then retrieves the data from the specific destination (which is given in the code already) - the data it retrieves and also stores will be:-
i) events of the current day and the goals of the respective events
ii)user's personalisation summary to send out an personalised notification message
iii)user's current day sticky note data for each routine
iv)the calendar completely
all the above data must be retrieved only, and below are editable retrive and write datas
v)since the notification shas buttons such as start, skip, snooze with two options - 2,5mins it should send the snooze notifications accordingly and also store and update the calendar of the specific event's status in the storage file for the web app to save the skip, start or completed status, along with this for each outine and each day, the extension must store one more data - the order of which they clicked the buttons that is the user snoozed thrice and skipped it finally - 2mins,5mins,2mins,skip - like this for each routine daily should be saved so that this data is accessed by the web application to generate the user's statistical data of their dailty procrastination ( this will be implemented later on in the web application as a new panel for now the saving of this data must be done)

Now next is the UI of the extension- small rectangular pop up in the right top taht can be minimized to a button state in the side or opened to this box state, when opened it displays the current day events (upcoming events upto 3) when a event is clicked it displays the sticky note's current day write up only readable version and a back button. has buttons such as - calendar - renders the calendar (only the current month data wiyth the stripes of event in it) and a back button to the initial panel of events, and the other button is to open the web app

When the notification is clicked directly it ipens the web application's calendar panel

-first time opening aeryth has its setting pop up
-formatting of text that aeryth sends to remove **
-fall back for aeryth unavailable
