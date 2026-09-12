-- Retained 150-problem curriculum metadata, preserving stable legacy IDs and ordering.
create table manor_private.leetcode_curriculum (
 id text primary key,topic text not null,name text not null,difficulty text not null check(difficulty in ('Easy','Medium','Hard')),
 curriculum_order integer not null unique check(curriculum_order between 0 and 149)
);
alter table manor_private.leetcode_curriculum enable row level security;
revoke all on manor_private.leetcode_curriculum from public,anon,authenticated;
insert into manor_private.leetcode_curriculum(id,topic,name,difficulty,curriculum_order) values
('neetcode-1-1','Arrays & Hashing','Contains Duplicate','Easy',0),
('neetcode-1-2','Arrays & Hashing','Valid Anagram','Easy',1),
('neetcode-1-3','Arrays & Hashing','Two Sum','Easy',2),
('neetcode-1-4','Arrays & Hashing','Group Anagrams','Medium',3),
('neetcode-1-5','Arrays & Hashing','Top K Frequent Elements','Medium',4),
('neetcode-1-6','Arrays & Hashing','Encode and Decode Strings','Medium',5),
('neetcode-1-7','Arrays & Hashing','Product of Array Except Self','Medium',6),
('neetcode-1-8','Arrays & Hashing','Valid Sudoku','Medium',7),
('neetcode-1-9','Arrays & Hashing','Longest Consecutive Sequence','Medium',8),
('neetcode-2-1','Two Pointers','Valid Palindrome','Easy',9),
('neetcode-2-2','Two Pointers','Two Sum II','Medium',10),
('neetcode-2-3','Two Pointers','3Sum','Medium',11),
('neetcode-2-4','Two Pointers','Container With Most Water','Medium',12),
('neetcode-2-5','Two Pointers','Trapping Rain Water','Hard',13),
('neetcode-3-1','Sliding Window','Best Time to Buy and Sell Stock','Easy',14),
('neetcode-3-2','Sliding Window','Longest Substring Without Repeating Characters','Medium',15),
('neetcode-3-3','Sliding Window','Longest Repeating Character Replacement','Medium',16),
('neetcode-3-4','Sliding Window','Permutation in String','Medium',17),
('neetcode-3-5','Sliding Window','Minimum Window Substring','Hard',18),
('neetcode-3-6','Sliding Window','Sliding Window Maximum','Hard',19),
('neetcode-4-1','Stack','Valid Parentheses','Easy',20),
('neetcode-4-2','Stack','Min Stack','Medium',21),
('neetcode-4-3','Stack','Evaluate Reverse Polish Notation','Medium',22),
('neetcode-4-4','Stack','Generate Parentheses','Medium',23),
('neetcode-4-5','Stack','Daily Temperatures','Medium',24),
('neetcode-4-6','Stack','Car Fleet','Medium',25),
('neetcode-4-7','Stack','Largest Rectangle in Histogram','Hard',26),
('neetcode-5-1','Binary Search','Binary Search','Easy',27),
('neetcode-5-2','Binary Search','Search a 2D Matrix','Medium',28),
('neetcode-5-3','Binary Search','Koko Eating Bananas','Medium',29),
('neetcode-5-4','Binary Search','Find Minimum in Rotated Sorted Array','Medium',30),
('neetcode-5-5','Binary Search','Search in Rotated Sorted Array','Medium',31),
('neetcode-5-6','Binary Search','Time Based Key Value Store','Medium',32),
('neetcode-5-7','Binary Search','Median of Two Sorted Arrays','Hard',33),
('neetcode-6-1','Linked List','Reverse Linked List','Easy',34),
('neetcode-6-2','Linked List','Merge Two Sorted Lists','Easy',35),
('neetcode-6-3','Linked List','Linked List Cycle','Easy',36),
('neetcode-6-4','Linked List','Reorder List','Medium',37),
('neetcode-6-5','Linked List','Remove Nth Node From End of List','Medium',38),
('neetcode-6-6','Linked List','Copy List with Random Pointer','Medium',39),
('neetcode-6-7','Linked List','Add Two Numbers','Medium',40),
('neetcode-6-8','Linked List','Find the Duplicate Number','Medium',41),
('neetcode-6-9','Linked List','LRU Cache','Medium',42),
('neetcode-6-10','Linked List','Merge K Sorted Lists','Hard',43),
('neetcode-6-11','Linked List','Reverse Nodes in K Group','Hard',44),
('neetcode-7-1','Trees','Invert Binary Tree','Easy',45),
('neetcode-7-2','Trees','Maximum Depth of Binary Tree','Easy',46),
('neetcode-7-3','Trees','Diameter of Binary Tree','Easy',47),
('neetcode-7-4','Trees','Balanced Binary Tree','Easy',48),
('neetcode-7-5','Trees','Same Tree','Easy',49),
('neetcode-7-6','Trees','Subtree of Another Tree','Easy',50),
('neetcode-7-7','Trees','Lowest Common Ancestor of a BST','Medium',51),
('neetcode-7-8','Trees','Binary Tree Level Order Traversal','Medium',52),
('neetcode-7-9','Trees','Binary Tree Right Side View','Medium',53),
('neetcode-7-10','Trees','Count Good Nodes in Binary Tree','Medium',54),
('neetcode-7-11','Trees','Validate Binary Search Tree','Medium',55),
('neetcode-7-12','Trees','Kth Smallest Element in a BST','Medium',56),
('neetcode-7-13','Trees','Construct Binary Tree from Preorder and Inorder','Medium',57),
('neetcode-7-14','Trees','Binary Tree Maximum Path Sum','Hard',58),
('neetcode-7-15','Trees','Serialize and Deserialize Binary Tree','Hard',59),
('neetcode-8-1','Heap / Priority Queue','Kth Largest Element in a Stream','Easy',60),
('neetcode-8-2','Heap / Priority Queue','Last Stone Weight','Easy',61),
('neetcode-8-3','Heap / Priority Queue','K Closest Points to Origin','Medium',62),
('neetcode-8-4','Heap / Priority Queue','Kth Largest Element in an Array','Medium',63),
('neetcode-8-5','Heap / Priority Queue','Task Scheduler','Medium',64),
('neetcode-8-6','Heap / Priority Queue','Design Twitter','Medium',65),
('neetcode-8-7','Heap / Priority Queue','Find Median from Data Stream','Hard',66),
('neetcode-9-1','Backtracking','Subsets','Medium',67),
('neetcode-9-2','Backtracking','Combination Sum','Medium',68),
('neetcode-9-3','Backtracking','Permutations','Medium',69),
('neetcode-9-4','Backtracking','Subsets II','Medium',70),
('neetcode-9-5','Backtracking','Combination Sum II','Medium',71),
('neetcode-9-6','Backtracking','Word Search','Medium',72),
('neetcode-9-7','Backtracking','Palindrome Partitioning','Medium',73),
('neetcode-9-8','Backtracking','Letter Combinations of a Phone Number','Medium',74),
('neetcode-9-9','Backtracking','N-Queens','Hard',75),
('neetcode-10-1','Tries','Implement Trie (Prefix Tree)','Medium',76),
('neetcode-10-2','Tries','Design Add and Search Words Data Structure','Medium',77),
('neetcode-10-3','Tries','Word Search II','Hard',78),
('neetcode-11-1','Graphs','Number of Islands','Medium',79),
('neetcode-11-2','Graphs','Max Area of Island','Medium',80),
('neetcode-11-3','Graphs','Clone Graph','Medium',81),
('neetcode-11-4','Graphs','Walls and Gates','Medium',82),
('neetcode-11-5','Graphs','Rotting Oranges','Medium',83),
('neetcode-11-6','Graphs','Pacific Atlantic Water Flow','Medium',84),
('neetcode-11-7','Graphs','Surrounded Regions','Medium',85),
('neetcode-11-8','Graphs','Course Schedule','Medium',86),
('neetcode-11-9','Graphs','Course Schedule II','Medium',87),
('neetcode-11-10','Graphs','Graph Valid Tree','Medium',88),
('neetcode-11-11','Graphs','Number of Connected Components in an Undirected Graph','Medium',89),
('neetcode-11-12','Graphs','Redundant Connection','Medium',90),
('neetcode-11-13','Graphs','Word Ladder','Hard',91),
('neetcode-12-1','Advanced Graphs','Reconstruct Itinerary','Hard',92),
('neetcode-12-2','Advanced Graphs','Min Cost to Connect All Points','Medium',93),
('neetcode-12-3','Advanced Graphs','Network Delay Time','Medium',94),
('neetcode-12-4','Advanced Graphs','Swim in Rising Water','Hard',95),
('neetcode-12-5','Advanced Graphs','Alien Dictionary','Hard',96),
('neetcode-12-6','Advanced Graphs','Cheapest Flights Within K Stops','Medium',97),
('neetcode-13-1','1-D Dynamic Programming','Climbing Stairs','Easy',98),
('neetcode-13-2','1-D Dynamic Programming','Min Cost Climbing Stairs','Easy',99),
('neetcode-13-3','1-D Dynamic Programming','House Robber','Medium',100),
('neetcode-13-4','1-D Dynamic Programming','House Robber II','Medium',101),
('neetcode-13-5','1-D Dynamic Programming','Longest Palindromic Substring','Medium',102),
('neetcode-13-6','1-D Dynamic Programming','Palindromic Substrings','Medium',103),
('neetcode-13-7','1-D Dynamic Programming','Decode Ways','Medium',104),
('neetcode-13-8','1-D Dynamic Programming','Coin Change','Medium',105),
('neetcode-13-9','1-D Dynamic Programming','Maximum Product Subarray','Medium',106),
('neetcode-13-10','1-D Dynamic Programming','Word Break','Medium',107),
('neetcode-13-11','1-D Dynamic Programming','Longest Increasing Subsequence','Medium',108),
('neetcode-13-12','1-D Dynamic Programming','Partition Equal Subset Sum','Medium',109),
('neetcode-14-1','2-D Dynamic Programming','Unique Paths','Medium',110),
('neetcode-14-2','2-D Dynamic Programming','Longest Common Subsequence','Medium',111),
('neetcode-14-3','2-D Dynamic Programming','Best Time to Buy and Sell Stock with Cooldown','Medium',112),
('neetcode-14-4','2-D Dynamic Programming','Coin Change II','Medium',113),
('neetcode-14-5','2-D Dynamic Programming','Target Sum','Medium',114),
('neetcode-14-6','2-D Dynamic Programming','Interleaving String','Medium',115),
('neetcode-14-7','2-D Dynamic Programming','Longest Increasing Path in a Matrix','Hard',116),
('neetcode-14-8','2-D Dynamic Programming','Distinct Subsequences','Hard',117),
('neetcode-14-9','2-D Dynamic Programming','Edit Distance','Medium',118),
('neetcode-14-10','2-D Dynamic Programming','Burst Balloons','Hard',119),
('neetcode-14-11','2-D Dynamic Programming','Regular Expression Matching','Hard',120),
('neetcode-15-1','Greedy','Maximum Subarray','Medium',121),
('neetcode-15-2','Greedy','Jump Game','Medium',122),
('neetcode-15-3','Greedy','Jump Game II','Medium',123),
('neetcode-15-4','Greedy','Gas Station','Medium',124),
('neetcode-15-5','Greedy','Hand of Straights','Medium',125),
('neetcode-15-6','Greedy','Merge Triplets to Form Target Triplet','Medium',126),
('neetcode-15-7','Greedy','Partition Labels','Medium',127),
('neetcode-15-8','Greedy','Valid Parenthesis String','Medium',128),
('neetcode-16-1','Intervals','Insert Interval','Medium',129),
('neetcode-16-2','Intervals','Merge Intervals','Medium',130),
('neetcode-16-3','Intervals','Non-overlapping Intervals','Medium',131),
('neetcode-16-4','Intervals','Meeting Rooms','Easy',132),
('neetcode-16-5','Intervals','Meeting Rooms II','Medium',133),
('neetcode-16-6','Intervals','Minimum Interval to Include Each Query','Hard',134),
('neetcode-17-1','Math & Geometry','Rotate Image','Medium',135),
('neetcode-17-2','Math & Geometry','Spiral Matrix','Medium',136),
('neetcode-17-3','Math & Geometry','Set Matrix Zeroes','Medium',137),
('neetcode-17-4','Math & Geometry','Happy Number','Easy',138),
('neetcode-17-5','Math & Geometry','Plus One','Easy',139),
('neetcode-17-6','Math & Geometry','Pow(x, n)','Medium',140),
('neetcode-17-7','Math & Geometry','Multiply Strings','Medium',141),
('neetcode-17-8','Math & Geometry','Detect Squares','Medium',142),
('neetcode-18-1','Bit Manipulation','Single Number','Easy',143),
('neetcode-18-2','Bit Manipulation','Number of 1 Bits','Easy',144),
('neetcode-18-3','Bit Manipulation','Counting Bits','Easy',145),
('neetcode-18-4','Bit Manipulation','Reverse Bits','Easy',146),
('neetcode-18-5','Bit Manipulation','Missing Number','Easy',147),
('neetcode-18-6','Bit Manipulation','Sum of Two Integers','Medium',148),
('neetcode-18-7','Bit Manipulation','Reverse Integer','Medium',149);
create function manor_private.seed_curriculum() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.leetcode_problems(user_id,id,topic,name,difficulty,curriculum_order)
 select new.id,id,topic,name,difficulty,curriculum_order from manor_private.leetcode_curriculum;
 return new;
end $$;
revoke all on function manor_private.seed_curriculum() from public,anon,authenticated;
create trigger seed_manor_curriculum after insert on auth.users for each row execute function manor_private.seed_curriculum();
insert into public.leetcode_problems(user_id,id,topic,name,difficulty,curriculum_order)
 select u.id,c.id,c.topic,c.name,c.difficulty,c.curriculum_order from auth.users u cross join manor_private.leetcode_curriculum c
 on conflict(user_id,id) do nothing;

-- One transactional replacement prevents partially refreshed shared job catalogs.
create function public.manor_replace_job_feed(p_etag text,p_expected_etag text,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous text; changed integer; removed integer;
begin
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows)>30000 then raise exception 'Job feed must contain at most 30000 validated listings'; end if;
 select etag into previous from public.job_feed_meta where id=1 for update;
 if previous is distinct from p_expected_etag then return '{"superseded":true}'::jsonb; end if;
 insert into public.job_listings(id,company,role,locations,url,posted,active,term,category)
 select id,company,role,locations,url,posted,true,term,category
 from jsonb_to_recordset(p_rows) as r(id text,company text,role text,locations text,url text,posted date,term text,category text)
 on conflict(id) do update set company=excluded.company,role=excluded.role,locations=excluded.locations,url=excluded.url,posted=excluded.posted,active=true,term=excluded.term,category=excluded.category,updated_at=now();
 get diagnostics changed=row_count;
 delete from public.job_listings j where not exists(select 1 from jsonb_array_elements(p_rows) r where r->>'id'=j.id);
 get diagnostics removed=row_count;
 update public.job_feed_meta set etag=p_etag,fetched_at=now() where id=1;
 return jsonb_build_object('listings',changed,'pruned',removed);
end $$;
revoke all on function public.manor_replace_job_feed(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.manor_replace_job_feed(text,text,jsonb) to service_role;
