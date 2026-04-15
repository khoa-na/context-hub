# Sổ Tay Vận Hành Trạm Khí Tượng Biển Sâu Aster-9

## 1. Mục đích tài liệu

Tài liệu này mô tả toàn bộ quy trình vận hành, bảo trì, giám sát và xử lý sự cố cho trạm khí tượng biển sâu Aster-9. Trạm Aster-9 là một tổ hợp bán tự động đặt trên thềm lục địa phía đông, chuyên thu thập dữ liệu về gió tầng thấp, áp suất mặt biển, độ mặn, dòng chảy ngầm, tiếng ồn sinh học và sự thay đổi nhiệt độ nước theo cột sâu.

Mục tiêu của tài liệu không phải là hướng dẫn nghiên cứu học thuật, mà là giúp đội vận hành đảm bảo trạm hoạt động liên tục trong môi trường có độ ăn mòn cao, khó tiếp cận, nhiều biến động thời tiết và giới hạn thời gian tiếp tế.

Tài liệu này áp dụng cho bốn nhóm người dùng:

- Điều phối viên bờ phụ trách lịch trực, cấu hình nhiệm vụ và xác nhận cảnh báo.
- Kỹ sư hệ thống phụ trách nguồn, mạng, cảm biến và vỏ áp lực.
- Thủy thủ đoàn tàu tiếp vận phụ trách tiếp cận, neo giữ, bốc dỡ và kiểm tra ngoại quan.
- Nhân sự phân tích dữ liệu phụ trách kiểm định chất lượng và phát hiện trôi cảm biến.

## 2. Tổng quan trạm Aster-9

Trạm Aster-9 được thiết kế theo mô hình ba lớp:

- Lớp mặt nước gồm phao nổi, radar sóng ngắn, cụm pin mặt trời, đèn định vị và ăng-ten liên lạc.
- Lớp cột giữa gồm cáp chịu lực, vòng giảm chấn, cảm biến nhiệt độ theo độ sâu, ống đo dòng chảy và bộ phát ping thủy âm.
- Lớp đáy gồm neo trọng lực, cụm nguồn dự phòng, khoang tính toán chống áp suất và kho dữ liệu lạnh.

Các mô-đun chính của trạm bao gồm:

- `WX-CORE`: máy điều phối nhiệm vụ và đồng bộ thời gian.
- `SALT-ARRAY`: dãy đo độ mặn theo nhiều tầng nước.
- `CURRENT-LATTICE`: hệ thống đo hướng và tốc độ dòng chảy.
- `BIO-ACOUSTIC`: cụm microphone thủy âm phục vụ theo dõi tín hiệu sinh học.
- `SKY-MAST`: cụm đo gió, độ ẩm không khí, mưa mặn và bức xạ mặt trời.
- `POWER-NEST`: bộ phân phối điện chính và giám sát pin.

Trạm có thể hoạt động độc lập trong 142 ngày nếu mất liên lạc với bờ, với điều kiện chu kỳ gửi dữ liệu được hạ xuống mức tiết kiệm và thuật toán ưu tiên mẫu được bật.

## 3. Nguyên tắc vận hành cốt lõi

Mọi quyết định vận hành phải tuân theo năm nguyên tắc sau:

1. Duy trì nguồn ổn định quan trọng hơn tăng mật độ lấy mẫu.
2. Không khởi động lại toàn trạm nếu chỉ có một mô-đun lỗi cục bộ.
3. Không cập nhật firmware trong cửa sổ gió mạnh hoặc trước chuyến tiếp vận dưới 48 giờ.
4. Luôn ưu tiên bảo toàn nhật ký sự kiện gốc trước khi thử bất kỳ hành động phục hồi nào.
5. Khi nghi ngờ dữ liệu sai nhưng phần cứng chưa được xác minh, phải gắn cờ chất lượng thay vì xóa mẫu.

Nếu đội bờ không chắc tình trạng phần cứng, hành động mặc định là chuyển sang chế độ quan sát thận trọng, giảm nhiệm vụ không thiết yếu và chờ xác nhận bổ sung từ tàu hoặc ảnh hiện trường.

## 4. Kiến trúc năng lượng

Nguồn điện của Aster-9 được cấp từ ba nhánh:

- Nhánh mặt trời công suất danh định 3.2 kW trong điều kiện trời quang.
- Cụm pin lithium-phosphate chịu muối với tổng dung lượng khả dụng 118 kWh.
- Bộ phát điện sóng phụ trợ chỉ dùng khi chiều cao sóng vượt ngưỡng kích hoạt nhưng không vượt ngưỡng an toàn cơ học.

Trong thực tế, nhánh mặt trời tạo ra dao động công suất mạnh vì sương muối bám mặt kính. Nếu công suất danh định giảm liên tục trong ba ngày và không có bão bụi muối được ghi nhận, điều phối viên phải tạo vé bảo trì cho chuyến tiếp tế gần nhất.

Quy tắc phân phối điện:

- `POWER-NEST` luôn cấp ưu tiên cao nhất cho `WX-CORE` và đồng hồ chuẩn.
- Cảm biến sinh học có thể giảm chu kỳ hoặc tạm ngủ theo lịch đêm nếu dung lượng pin xuống dưới 28%.
- Tải sưởi chống ngưng tụ chỉ được phép hoạt động liên tục khi nhiệt độ trong khoang dưới 7 độ C và độ ẩm tương đối trên 82%.
- Tải truyền dữ liệu khối lớn phải chạy trong khung 10:00 đến 14:00 theo giờ địa phương nếu không có yêu cầu khẩn cấp.

## 5. Chế độ hoạt động

Trạm hỗ trợ sáu chế độ vận hành:

### 5.1 Chế độ Chuẩn

Đây là chế độ mặc định. Trạm lấy mẫu theo lịch đầy đủ, gửi gói tóm tắt mỗi 10 phút và gửi gói thô mỗi 60 phút.

### 5.2 Chế độ Tiết Kiệm

Được kích hoạt tự động khi pin xuống dưới 35% hoặc khi dự báo thời tiết cho thấy ba ngày bức xạ thấp liên tiếp. Một số tác vụ bị giảm:

- Gửi dữ liệu thô mỗi 4 giờ.
- Cảm biến thủy âm chỉ ghi cửa sổ 5 phút mỗi 30 phút.
- Radar sóng ngắn chuyển sang chu kỳ quét giãn cách.

### 5.3 Chế độ Bão

Chế độ này khóa mọi cập nhật cấu hình từ xa không khẩn cấp. Tần suất đo một số cảm biến cơ học tăng lên để theo dõi tải lên cáp neo.

### 5.4 Chế độ Bảo Trì Tại Chỗ

Khi có tàu tiếp cận và kỹ sư bám trạm, bộ điều phối cho phép treo từng mô-đun mà không làm ngắt toàn hệ thống. Chế độ này chỉ dùng trong cửa sổ thao tác có giám sát người thật.

### 5.5 Chế độ Chẩn Đoán

Kích hoạt khi cần đo độ trễ bus nội bộ, kiểm tra CRC lưu trữ hoặc so đối chiếu đồng hồ. Không được để chế độ này chạy quá 90 phút vì nó tăng tải CPU đáng kể.

### 5.6 Chế độ Cô Lập Mô-đun

Cho phép cắt logic một mô-đun lỗi khỏi bus nhiệm vụ. Ví dụ có thể cô lập `BIO-ACOUSTIC` nếu mô-đun này gây nghẽn ghi dữ liệu mà vẫn giữ các phép đo thời tiết và hải dương học.

## 6. Lịch trực và bàn giao

Đội bờ vận hành theo ba ca:

- Ca Bình Minh: 05:30-13:30
- Ca Chiều Muộn: 13:30-21:30
- Ca Đêm Sâu: 21:30-05:30

Mỗi ca bàn giao phải bao gồm tối thiểu các nội dung sau:

- Mức pin thấp nhất và cao nhất trong ca.
- Các cảnh báo đã xác nhận nhưng chưa khắc phục.
- Tình trạng liên lạc vệ tinh, vô tuyến tầm gần và kênh thủy âm.
- Bất kỳ mô-đun nào đang ở chế độ giảm tải.
- Danh sách thay đổi cấu hình đã áp dụng.
- Nhận định ngắn về xu hướng bất thường của dữ liệu.

Ví dụ bàn giao tốt:

> Từ 17:00 đến 19:20 xuất hiện sụt áp ngắn trên bus phụ, chưa tái diễn sau khi hạ tải radar. Dữ liệu độ mặn tầng 40 m dao động vượt dải thường lệ nhưng vẫn tương quan với nhiệt độ, tạm gắn cờ theo dõi thay vì đánh lỗi.

Ví dụ bàn giao kém:

> Hôm nay có vài cảnh báo, chắc ổn rồi.

## 7. Quy trình khởi động lạnh

Khởi động lạnh chỉ được áp dụng khi:

- trạm mất điện hoàn toàn trên 6 giờ,
- khoang tính toán không phản hồi qua cả ba kênh,
- hoặc sau khi thay toàn bộ cụm pin điều khiển.

Các bước:

1. Xác nhận điện áp đầu vào từng nhánh trước khi cấp tải logic.
2. Bật `WX-CORE` ở chế độ chờ 3 phút để đồng bộ đồng hồ và tự kiểm tra lưu trữ.
3. Gắn từng cụm cảm biến trở lại theo thứ tự `SKY-MAST`, `SALT-ARRAY`, `CURRENT-LATTICE`, `BIO-ACOUSTIC`.
4. Chạy bài kiểm tra heartbeat nội bộ trong ít nhất 12 phút.
5. Chỉ cho phép gửi dữ liệu ra bờ sau khi hàng đợi cục bộ không còn lỗi ghi.

Không được bỏ qua bước làm ấm tụ điện trong thời tiết dưới 8 độ C. Bỏ qua bước này từng gây ra hiện tượng dòng khởi động tăng vọt và khóa bộ bảo vệ ở phiên bản trạm Aster-7.

## 8. Kiểm tra đầu ngày

Mỗi ca sáng phải hoàn thành checklist đầu ngày dưới đây:

- Xem biểu đồ pin 24 giờ gần nhất.
- Kiểm tra nhiệt độ khoang tính toán.
- Kiểm tra tỷ lệ gói tin thất lạc theo từng kênh truyền.
- So sánh vận tốc gió với xu hướng áp suất để phát hiện cảm biến gió kẹt cơ.
- Kiểm tra độ mặn bề mặt và độ mặn tầng giữa có nhảy bậc bất thường hay không.
- Xác nhận dung lượng trống của kho dữ liệu lạnh còn trên 18%.
- Kiểm tra đồng hồ hệ thống lệch dưới 2 giây so với nguồn chuẩn.

Nếu một hạng mục không đạt, ca trực phải gắn nhãn mức độ:

- `OBSERVE`: theo dõi thêm, chưa can thiệp.
- `ACTION`: cần thay đổi cấu hình hoặc chẩn đoán từ xa.
- `VESSEL`: cần tàu tiếp cận và kiểm tra vật lý.

## 9. Kiểm tra hàng tuần

Mỗi thứ Hai lúc 09:00 giờ địa phương, đội bờ thực hiện kiểm tra sâu:

- Chạy so đối chiếu dữ liệu nội bộ giữa cặp cảm biến cùng tầng.
- Tải nhật ký SMART của kho lưu trữ cục bộ.
- Kiểm tra sai số tích lũy của đồng hồ theo bản ghi 7 ngày.
- So khớp số mẫu dự kiến với số mẫu thực tế để phát hiện mất đoạn im lặng.
- Kiểm tra bề mặt pin mặt trời qua ảnh chụp gần nhất.
- Đánh giá tiếng ồn nền của microphone thủy âm ở khung giờ 02:00-03:00.

Kết quả kiểm tra hàng tuần phải lưu vào sổ vận hành với mẫu thống nhất:

| Mục | Trạng thái | Ghi chú |
| --- | --- | --- |
| Nguồn | Đạt | Dao động trong dải bình thường |
| Lưu trữ | Cần theo dõi | Một ổ có tốc độ ghi giảm 8% |
| Mạng | Đạt | Không có tăng đột biến RTT |
| Cảm biến gió | Đạt | Không lệch pha so với áp suất |
| Độ mặn 40 m | Theo dõi | Nhiễu nhẹ trong hai ngày mưa mặn |

## 10. Bảo trì cơ khí ngoài hiện trường

Khi tàu tiếp cận trạm, đội hiện trường phải làm việc theo cặp và tuân thủ giới hạn gió. Không một thao tác bám phao nào được thực hiện khi gió giật vượt 28 hải lý/giờ hoặc sóng hiệu dụng vượt 1.8 m.

Hạng mục bảo trì tiêu chuẩn gồm:

- Rửa sạch cặn muối khỏi mặt pin và chụp ảnh trước/sau.
- Kiểm tra vết nứt vi mô trên chân đỡ ăng-ten.
- Kiểm tra mối nối cáp treo cảm biến nhiệt.
- Đo độ mòn của vòng giảm chấn tại ba điểm chuẩn.
- Thay túi hút ẩm trong khoang trên mặt nước.
- Kiểm tra lớp sơn chống ăn mòn ở bốn vùng dễ va đập.

Sau mỗi thao tác, kỹ sư phải ghi lại mã vật tư, thời gian thao tác và ảnh chứng minh. Dữ liệu này hữu ích khi phân tích một lỗi chậm xuất hiện nhiều tuần sau đó.

## 11. Quản lý dữ liệu

Dữ liệu từ trạm đi qua ba tầng lưu trữ:

- Bộ đệm nóng phục vụ quyết định thời gian thực.
- Kho lạnh cục bộ giữ bản thô 180 ngày.
- Gói đồng bộ bờ phục vụ phân tích dài hạn.

Các nguyên tắc quản lý dữ liệu:

- Không chỉnh sửa bản thô sau khi nhận.
- Mọi gắn cờ chất lượng phải là metadata bổ sung.
- Mọi khoảng trống dữ liệu phải có mã lý do.
- Không trộn dữ liệu hiệu chuẩn với dữ liệu khai thác nếu chưa phân nhánh rõ.

Các mã lý do mất dữ liệu thường dùng:

- `PWR_DROP`: sụt áp nguồn.
- `LINK_OUT`: mất liên lạc.
- `SENSOR_DRIFT`: trôi cảm biến vượt ngưỡng.
- `MAINT_WINDOW`: cửa sổ bảo trì có chủ ý.
- `CONDENSATION_LOCK`: mô-đun tự khóa vì ngưng tụ.

## 12. Phát hiện trôi cảm biến

Trôi cảm biến là lỗi khó chịu nhất vì dữ liệu nhìn bề ngoài có vẻ hợp lệ. Để phát hiện sớm, đội phân tích dùng ba lớp kiểm tra:

1. So với cảm biến lân cận cùng tầng.
2. So với quy luật vật lý giữa các đại lượng liên quan.
3. So với đường cơ sở lịch sử trong điều kiện tương tự.

Ví dụ điển hình:

- Nếu nhiệt độ tầng 15 m tăng nhưng độ mặn, mật độ và dòng chảy đều không cho thấy thay đổi tương ứng, cần nghi ngờ cảm biến nhiệt bị bám sinh vật.
- Nếu cảm biến gió báo bằng phẳng tuyệt đối trong khi áp suất và sóng biển biến động mạnh, cần nghi ngờ trục quay bị kẹt muối.
- Nếu microphone thủy âm có nền nhiễu trắng tăng chậm theo tuần, có thể cáp chống nước bị mỏi và hút ẩm vi lượng.

## 13. Cảnh báo và phân loại ưu tiên

Tất cả cảnh báo của trạm được phân loại theo bốn mức:

### 13.1 Mức Xanh

Biến động trong ngưỡng chấp nhận, không cần hành động tức thời.

### 13.2 Mức Vàng

Bất thường vừa phải, cần xác minh trong ca hiện tại. Ví dụ nhiệt độ khoang tăng 4 độ trong 30 phút nhưng chưa chạm ngưỡng nguy hiểm.

### 13.3 Mức Cam

Có nguy cơ ảnh hưởng đến một phần nhiệm vụ trong 24 giờ tới. Ví dụ pin giảm nhanh khi dự báo bức xạ thấp hoặc tỷ lệ lỗi CRC ghi đĩa tăng vượt dải nền.

### 13.4 Mức Đỏ

Đe dọa an toàn trạm hoặc mất dữ liệu diện rộng. Ví dụ mất hoàn toàn bus nguồn phụ, khoang áp lực bị nước xâm nhập, hoặc neo có dấu hiệu dịch chuyển.

Quy tắc phản hồi:

- Mức Vàng: xác nhận trong 30 phút.
- Mức Cam: xác nhận trong 10 phút, có người chịu trách nhiệm rõ ràng.
- Mức Đỏ: gọi trực tiếp điều phối chính, dừng mọi thay đổi không khẩn cấp.

## 14. Ứng xử khi mất liên lạc

Mất liên lạc không đồng nghĩa trạm đã ngừng hoạt động. Cần phân biệt ba trường hợp:

- Mất đường vệ tinh nhưng vẫn còn ping thủy âm.
- Mất đồng thời vệ tinh và vô tuyến gần, nhưng nhật ký cuối cho thấy nguồn ổn định.
- Mất hoàn toàn mọi kênh sau chuỗi cảnh báo nguồn hoặc ngập nước.

Quy trình chuẩn khi mất liên lạc:

1. Kiểm tra trạm lân cận để loại trừ lỗi diện rộng từ mạng bờ.
2. Kiểm tra thời tiết và tải bức xạ gần nhất.
3. Gửi lệnh đánh thức tối thiểu theo ba chu kỳ cách nhau 15 phút.
4. Nếu có tín hiệu thủy âm phản hồi, không gửi lệnh khởi động lại ngay.
5. Chỉ khi quá 2 giờ không có bất kỳ dấu hiệu nào mới nâng mức lên `VESSEL`.

## 15. Ứng xử khi ngập nước khoang

Đây là kịch bản nghiêm trọng nhất. Dấu hiệu nhận biết gồm:

- Độ ẩm tăng đột ngột trong khoang kín.
- Nhiệt độ mạch điều khiển giảm bất thường.
- Dòng rò tăng trên bus phụ.
- Camera nội khoang xuất hiện mờ sương đồng nhất.

Khi có nghi ngờ ngập nước:

1. Cô lập ngay nhánh nguồn nghi ngờ.
2. Không cố bật lại mô-đun vừa tắt.
3. Khóa mọi tác vụ ghi nặng không cần thiết.
4. Tạo ảnh chụp tức thì từ camera nếu còn được.
5. Chuẩn bị chuyến tiếp cận gần nhất với vật tư thay gioăng, túi hút ẩm, board nguồn dự phòng.

Sau sự kiện ngập nước, mọi dữ liệu từ mô-đun liên quan phải được gắn cờ nghi ngờ cho đến khi hoàn tất hiệu chuẩn lại.

## 16. Quy trình cập nhật firmware

Cập nhật firmware là tác vụ rủi ro trung bình nhưng có thể tạo lỗi lan truyền nếu làm sai trình tự.

Điều kiện tiên quyết:

- Pin trên 62%.
- Không có cảnh báo Cam hoặc Đỏ đang mở.
- RTT đường truyền vệ tinh ổn định trong 20 phút.
- Có bản sao cấu hình hiện hành và ảnh chụp mã build đang chạy.

Trình tự khuyến nghị:

1. Cập nhật mô-đun phụ trước, không cập nhật `WX-CORE` trước tiên.
2. Sau mỗi mô-đun, chờ 8 phút để kiểm tra heartbeat.
3. Nếu một mô-đun khởi động lại quá 2 lần, dừng toàn bộ chiến dịch cập nhật.
4. Không cập nhật quá 3 mô-đun trong cùng một cửa sổ 6 giờ.

## 17. Hiệu chuẩn định kỳ

Hiệu chuẩn tại Aster-9 chia thành hai nhóm:

- Hiệu chuẩn mềm từ xa bằng tham số bù trừ.
- Hiệu chuẩn cứng ngoài hiện trường bằng thiết bị chuẩn.

Những cảm biến có thể hiệu chuẩn mềm:

- đồng hồ hệ thống,
- ngưỡng tiếng ồn nền,
- offset nhỏ của nhiệt độ,
- ngưỡng phát hiện rung động.

Những cảm biến phải hiệu chuẩn cứng:

- độ mặn chuẩn tầng sâu,
- đầu đo áp lực neo,
- cảm biến dòng chảy chính,
- bộ đo hướng gió cơ học.

Quy tắc vàng: không áp offset quá 2 kỳ liên tiếp cho cùng một cảm biến mà không có kiểm tra vật lý. Làm vậy dễ che giấu lỗi hỏng dần.

## 18. Mẫu sự cố điển hình

### 18.1 Sự cố "Muối Bụi Bình Minh"

Xuất hiện sau đêm có gió đổi hướng. Sáng hôm sau sản lượng mặt trời giảm mạnh dù trời quang. Nguyên nhân thường là lớp hạt muối mịn phủ không đều lên tấm pin và cảm biến bức xạ.

Khắc phục:

- xác nhận bằng ảnh,
- chuyển tạm sang chế độ tiết kiệm,
- lên lịch vệ sinh ở chuyến tàu gần nhất.

### 18.2 Sự cố "Dòng Chảy Ma"

Hệ thống báo dòng chảy tầng giữa tăng đột ngột nhưng các tầng khác yên tĩnh. Thường do một đầu đo bị dây rong biển quấn lệch góc.

Khắc phục:

- đối chiếu tín hiệu rung,
- xem ảnh camera cột giữa nếu có,
- nếu không chắc thì gắn cờ chất lượng chứ không sửa số liệu.

### 18.3 Sự cố "Đêm Im Lặng"

`BIO-ACOUSTIC` đột nhiên ghi nền thấp bất thường trên mọi dải tần. Hóa ra bộ lợi tự động bị kẹt ở mức tối thiểu sau một lần quá tải.

Khắc phục:

- reset riêng mô-đun thủy âm,
- chạy bài test tiếng chuẩn,
- xác nhận đường đáp tuyến quay lại bình thường.

## 19. Chuẩn ghi nhật ký

Nhật ký tốt phải ngắn gọn nhưng đủ tái dựng sự kiện. Mỗi bản ghi nên có:

- thời gian UTC,
- người xác nhận,
- mã cảnh báo hoặc tác vụ,
- hành động đã làm,
- kết quả quan sát,
- bước tiếp theo nếu còn mở.

Ví dụ:

```text
2026-06-04T03:15:00Z | ca_dem_sau | ALERT-CAM-214 |
Ha chu ky radar tu 2 phut len 10 phut de giam tai nguon |
Dong pin giam tu 18.1A xuong 11.4A sau 12 phut |
Theo doi den 05:00, chua can tau tiep can
```

Ví dụ không đạt:

```text
Da sua xong, co ve on
```

## 20. Chỉ số sức khỏe trạm

Mỗi ngày đội bờ phải theo dõi tám chỉ số cốt lõi:

- `power_reserve_hours`
- `mean_packet_loss`
- `clock_drift_seconds`
- `sensor_drift_flags`
- `storage_free_percent`
- `hull_humidity_index`
- `solar_output_ratio`
- `critical_alert_open_count`

Nếu từ ba chỉ số trở lên cùng xấu đi trong hai ngày liên tiếp, phải mở phiên đánh giá liên ngành thay vì xử lý từng cảnh báo riêng lẻ.

## 21. Mẫu câu hỏi thường gặp

### Trạm có tự khởi động lại khi mất vệ tinh không?

Không. Mất vệ tinh chỉ ảnh hưởng truyền dữ liệu, không phải điều kiện để khởi động lại.

### Khi nào được xóa hàng đợi dữ liệu cục bộ?

Chỉ khi đã xác minh có bản sao đầy đủ ở bờ và hàng đợi đang chặn ghi mới, đồng thời có phê duyệt của kỹ sư hệ thống chính.

### Có nên tăng tần suất lấy mẫu khi có bão?

Có chọn lọc. Chỉ tăng cho cảm biến liên quan tải cơ học và an toàn trạm. Không tăng tràn lan vì sẽ làm áp lực lên nguồn và lưu trữ.

### Vì sao không nên cập nhật tất cả mô-đun cùng lúc?

Vì như vậy rất khó xác định mô-đun nào gây lỗi hồi quy và làm tăng nguy cơ trạm vào trạng thái lỗi dây chuyền.

## 22. Thuật ngữ nội bộ

- `cua so lang`: khoảng 30 phút có gió và sóng đủ ổn định để thao tác trên phao.
- `bui muoi`: lớp hạt muối bám khô trên bề mặt pin hoặc cảm biến.
- `doi xung du lieu`: hiện tượng hai cảm biến khác loại cùng phản ánh một biến động vật lý hợp lý.
- `dung nguon sach`: trạng thái mọi nhánh nguồn đều trong dải gợn cho phép.
- `mat troi cheo`: khung giờ bức xạ cao nhưng góc chiếu làm một phần mảng pin bị bóng đổ từ cột ăng-ten.

## 23. Checklist trước chuyến tiếp vận

Trước khi tàu rời bờ, điều phối viên phải chuẩn bị:

- danh sách cảnh báo mở,
- sơ đồ mô-đun nghi ngờ lỗi,
- danh mục vật tư thay thế,
- bản in ảnh hiện trường gần nhất,
- kế hoạch thao tác tối đa 4 giờ,
- phương án rút lui nếu thời tiết đảo chiều.

Vật tư nên có sẵn trên tàu:

- gioăng khoang chuẩn A9,
- đầu nối chống nước ba cỡ,
- board nguồn phụ,
- túi hút ẩm loại chịu muối,
- khăn lau không xơ cho pin mặt trời,
- camera nội soi đầu mềm,
- bộ đo điện trở cách điện cầm tay.

## 24. Checklist sau chuyến tiếp vận

Trong vòng 6 giờ sau khi tàu quay về hoặc rời trạm, đội bờ phải:

- cập nhật sổ vật tư đã dùng,
- đối chiếu ảnh trước/sau,
- gắn mốc thời gian cho mọi thay đổi cấu hình,
- tăng cường giám sát 24 giờ sau bảo trì,
- xác nhận không xuất hiện lỗi phụ sau thao tác.

Đây là giai đoạn dễ bỏ sót nhất vì mọi người thường cho rằng sự cố đã giải quyết xong sau khi tàu rời hiện trường.

## 25. Kịch bản diễn tập định kỳ

Mỗi quý phải có ít nhất một buổi diễn tập bàn giấy và một buổi diễn tập kỹ thuật. Các kịch bản khuyến nghị:

- mất liên lạc vệ tinh kéo dài 8 giờ,
- pin xuống 18% giữa ba ngày mây dày,
- cảm biến độ mặn tầng sâu trôi chậm,
- nước xâm nhập khoang trên,
- neo dịch chuyển 0.7 m sau bão.

Mục tiêu diễn tập không phải để đi đến câu trả lời hoàn hảo, mà để kiểm tra tốc độ phân loại, chất lượng ghi chép và khả năng phối hợp giữa bờ với tàu.

## 26. Kết luận

Trạm khí tượng biển sâu Aster-9 là hệ thống hoạt động trong một môi trường mà mọi sai sót nhỏ đều có thể biến thành chuỗi sự cố kéo dài. Điều giúp trạm bền vững không phải là cố làm cho mọi thứ luôn hoàn hảo, mà là duy trì kỷ luật vận hành, ghi chép minh bạch, phản ứng bình tĩnh và tránh những can thiệp quá tay khi bằng chứng còn chưa đủ.

Nếu phải tóm tắt toàn bộ tài liệu trong một câu, thì câu đó là: hãy giữ nguồn sạch, dữ liệu trung thực, thay đổi có kiểm soát và luôn để lại dấu vết rõ ràng cho người trực sau.
