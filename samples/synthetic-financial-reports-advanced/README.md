# Bộ báo cáo tài chính giả lập nâng cao 2026

Bộ này được thiết kế để khó hơn đáng kể so với bộ `samples/synthetic-financial-reports`.

Điểm khó được cài vào bộ dữ liệu:
- Báo cáo dài hơn, nhiều lớp dữ liệu hơn, có phụ lục và câu hỏi hội đồng quản trị.
- Có các chỉ báo nhìn bề ngoài tích cực nhưng chất lượng thấp, ví dụ doanh thu tăng nhưng dòng tiền xấu, EBITDA hồi phục nhưng nhờ hoàn nhập và trì hoãn chi phí.
- Có các mâu thuẫn nhẹ giữa phần điều hành, phần vận hành và phần vốn lưu động để mô hình phải đối chiếu liên phần.
- Có nhiều bảng chia theo kênh, ngành hàng, khu vực, cohort khách hàng, tồn kho, công nợ, covenant, capex và tiến độ dự án.
- Q1 và Q2 tăng nhẹ, Q3 suy giảm mạnh, Q4 hồi phục một phần nhưng chưa sạch.

Doanh nghiệp giả lập: Helios OmniRetail Group
Ngành: bán lẻ đa kênh, marketplace services, B2B procurement và private label
Đơn vị tiền tệ: tỷ VND, trừ khi ghi chú khác

Các file:
- `bao-cao-tai-chinh-gia-lap-nang-do-q1-2026.md`
- `bao-cao-tai-chinh-gia-lap-nang-do-q2-2026.md`
- `bao-cao-tai-chinh-gia-lap-nang-do-q3-2026.md`
- `bao-cao-tai-chinh-gia-lap-nang-do-q4-2026.md`

Gợi ý câu hỏi test khó:
- Nếu bỏ các khoản one-off, chất lượng lợi nhuận thật đang diễn biến như thế nào?
- Q3 giảm mạnh là vì cầu suy yếu, vận hành vỡ, sai chính sách giá hay cấu trúc đòn bẩy vận hành?
- Q4 hồi phục là hồi phục thật hay chỉ là hồi phục kế toán và cắt chi phí?
- Phần nào trong báo cáo điều hành có xu hướng tô hồng và phần nào trong phụ lục lại phủ định điều đó?
- Khủng hoảng thanh khoản tiềm ẩn nằm ở tồn kho, phải thu, covenant hay cam kết capex?
- Nếu là CFO mới vào từ Q1/2027, ba việc đầu tiên cần làm là gì?
